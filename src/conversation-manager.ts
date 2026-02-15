import { v4 as uuidv4 } from "uuid";
import { eq, and, desc } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  agentConversations,
  agentMessages,
  type AgentConversation,
  type AgentMessage,
  type InsertAgentConversation,
  type InsertAgentMessage,
} from "./schema";

/**
 * Conversation Manager
 * 
 * Manages multi-turn conversation state, message history, and context
 */

export interface ConversationContext {
  currentPage?: string;
  workflowStage?: string;
  relevantDocuments?: string[];
  relevantFacts?: string[];
}

export interface CreateConversationParams {
  userId: number;
  projectId?: number;
  title?: string;
  context?: ConversationContext;
}

export interface AddMessageParams {
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>;
  toolCallId?: string;
  metadata?: {
    tokens?: number;
    model?: string;
    latency?: number;
    error?: string;
  };
}

export class ConversationManager {
  constructor(private db: MySql2Database<any>) {}

  /**
   * Create a new conversation
   */
  async createConversation(params: CreateConversationParams): Promise<AgentConversation> {
    const conversationId = uuidv4();
    const conversation: InsertAgentConversation = {
      id: conversationId,
      userId: params.userId,
      projectId: params.projectId ?? null,
      title: params.title || `Conversation ${new Date().toISOString()}`,
      context: params.context || {},
      status: "active",
    };

    await this.db.insert(agentConversations).values(conversation);

    const [created] = await this.db
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.id, conversationId));

    if (!created) {
      throw new Error("Failed to create conversation");
    }

    return created;
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string): Promise<AgentConversation | null> {
    const [conversation] = await this.db
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.id, conversationId));

    return conversation || null;
  }

  /**
   * Get all conversations for a user and project
   */
  async getConversations(
    userId: number,
    projectId?: number,
    limit: number = 50
  ): Promise<AgentConversation[]> {
    const conditions = [eq(agentConversations.userId, userId)];
    if (projectId !== undefined) {
      conditions.push(eq(agentConversations.projectId, projectId));
    }
    return await this.db
      .select()
      .from(agentConversations)
      .where(and(...conditions))
      .orderBy(desc(agentConversations.updatedAt))
      .limit(limit);
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(params: AddMessageParams): Promise<AgentMessage> {
    const messageId = uuidv4();
    // IMPORTANT: Use null (not undefined) for optional fields.
    // mysql2 converts undefined to empty string '', which breaks JSON columns
    // and nullable varchar columns. null is properly sent as SQL NULL.
    // Do NOT include createdAt — let the DB defaultNow() handle it.
    const message: InsertAgentMessage = {
      id: messageId,
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      toolCalls: params.toolCalls ?? null,
      toolCallId: params.toolCallId ?? null,
      metadata: params.metadata ?? null,
    };

    await this.db.insert(agentMessages).values(message);

    // Update conversation's updatedAt timestamp
    await this.db
      .update(agentConversations)
      .set({ updatedAt: new Date() })
      .where(eq(agentConversations.id, params.conversationId));

    const [created] = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.id, messageId));

    if (!created) {
      throw new Error("Failed to add message");
    }

    return created;
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(
    conversationId: string,
    limit: number = 100
  ): Promise<AgentMessage[]> {
    return await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))
      .orderBy(agentMessages.createdAt, agentMessages.id)
      .limit(limit);
  }

  /**
   * Get recent messages for context window
   */
  async getRecentMessages(
    conversationId: string,
    count: number = 10
  ): Promise<AgentMessage[]> {
    const messages = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(count);

    return messages.reverse(); // Return in chronological order
  }

  /**
   * Build conversation history for LLM context
   * 
   * IMPORTANT: This method preserves the full message structure including
   * tool_calls on assistant messages and tool_call_id on tool messages.
   * OpenAI requires that:
   * 1. Messages with role 'tool' must follow an assistant message with tool_calls
   * 2. Tool messages must include tool_call_id matching the assistant's tool_calls
   */
  async buildLLMContext(
    conversationId: string,
    maxMessages: number = 20
  ): Promise<Array<Record<string, any>>> {
    const messages = await this.getRecentMessages(conversationId, maxMessages);

    // Validate message sequence to ensure complete tool call sequences
    // OpenAI requires:
    // 1. Tool messages must follow an assistant message with tool_calls
    // 2. ALL tool_call_ids in an assistant message must have corresponding tool responses
    
    // First pass: identify which assistant messages have complete tool responses
    const assistantToolCallMap = new Map<string, Set<string>>(); // msg.id -> Set of tool_call_ids
    const toolResponseMap = new Map<string, Set<string>>(); // assistant msg.id -> Set of responded tool_call_ids
    
    let currentAssistantId: string | null = null;
    
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        currentAssistantId = msg.id;
        const toolCallIds = new Set(msg.toolCalls.map((tc: any) => tc.id));
        assistantToolCallMap.set(msg.id, toolCallIds);
        toolResponseMap.set(msg.id, new Set());
      } else if (msg.role === 'tool' && currentAssistantId) {
        const toolCallId = (msg as any).toolCallId || msg.toolCalls?.[0]?.id;
        if (toolCallId) {
          toolResponseMap.get(currentAssistantId)?.add(toolCallId);
        }
      } else if (msg.role === 'user' || msg.role === 'system' || (msg.role === 'assistant' && (!msg.toolCalls || msg.toolCalls.length === 0))) {
        currentAssistantId = null;
      }
    }
    
    // Second pass: build validated message list, skipping incomplete tool call sequences
    const validatedMessages: typeof messages = [];
    let skipUntilNextUserMessage = false;
    currentAssistantId = null;
    
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'system') {
        skipUntilNextUserMessage = false;
        currentAssistantId = null;
        validatedMessages.push(msg);
      } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // Check if this assistant message has all its tool responses
        const expectedToolCalls = assistantToolCallMap.get(msg.id);
        const actualResponses = toolResponseMap.get(msg.id);
        
        const hasAllResponses = expectedToolCalls && actualResponses && 
          expectedToolCalls.size === actualResponses.size &&
          Array.from(expectedToolCalls).every(id => actualResponses.has(id));
        
        if (hasAllResponses) {
          currentAssistantId = msg.id;
          skipUntilNextUserMessage = false;
          validatedMessages.push(msg);
        } else {
          console.warn(`[VALIDATION] Skipping assistant message with incomplete tool responses: ${msg.id}`);
          console.warn(`[VALIDATION] Expected ${expectedToolCalls?.size} responses, got ${actualResponses?.size}`);
          skipUntilNextUserMessage = true;
          currentAssistantId = null;
        }
      } else if (msg.role === 'tool') {
        // Only include tool messages if we're not skipping and they belong to current assistant
        if (!skipUntilNextUserMessage && currentAssistantId) {
          validatedMessages.push(msg);
        } else {
          console.warn(`[VALIDATION] Skipping tool message (orphaned or incomplete sequence): ${msg.id}`);
        }
      } else {
        // Regular assistant messages without tool_calls
        if (!skipUntilNextUserMessage) {
          validatedMessages.push(msg);
        }
        currentAssistantId = null;
      }
    }

    return validatedMessages.map((msg) => {
      // IMPORTANT: Ensure content is never null - OpenAI requires non-null content for tool messages
      const content = msg.content != null ? msg.content : "";
      
      const llmMessage: Record<string, any> = {
        role: msg.role,
        content: content,
      };

      // Preserve tool_calls on assistant messages
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        llmMessage.content = msg.content || null;
        llmMessage.tool_calls = msg.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === "string"
              ? tc.arguments
              : JSON.stringify(tc.arguments),
          },
        }));
      }

      // Preserve tool_call_id on tool messages
      if (msg.role === "tool") {
        const toolCallId = (msg as any).toolCallId;
        if (toolCallId) {
          llmMessage.tool_call_id = toolCallId;
        } else if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Fallback: try to get tool_call_id from toolCalls metadata
          llmMessage.tool_call_id = msg.toolCalls[0]?.id;
        }
      }

      return llmMessage;
    });
  }

  /**
   * Update conversation context
   */
  async updateContext(
    conversationId: string,
    context: Partial<ConversationContext>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const existingContext = typeof conversation.context === "string"
      ? JSON.parse(conversation.context as string)
      : (conversation.context || {});

    const updatedContext = {
      ...existingContext,
      ...context,
    };

    await this.db
      .update(agentConversations)
      .set({ context: updatedContext })
      .where(eq(agentConversations.id, conversationId));
  }

  /**
   * Archive a conversation
   */
  async archiveConversation(conversationId: string): Promise<void> {
    await this.db
      .update(agentConversations)
      .set({ status: "archived" })
      .where(eq(agentConversations.id, conversationId));
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(conversationId: string): Promise<void> {
    // Delete messages first
    await this.db
      .delete(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId));

    // Delete conversation
    await this.db
      .delete(agentConversations)
      .where(eq(agentConversations.id, conversationId));
  }

  /**
   * Get conversation summary statistics
   */
  async getConversationStats(conversationId: string): Promise<{
    messageCount: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalTokens: number;
    averageLatency: number;
  }> {
    const messages = await this.getMessages(conversationId);

    const parseMetadata = (m: AgentMessage) => {
      if (!m.metadata) return {};
      if (typeof m.metadata === "string") {
        try { return JSON.parse(m.metadata as string); } catch { return {}; }
      }
      return m.metadata;
    };

    const parseToolCalls = (m: AgentMessage) => {
      if (!m.toolCalls) return [];
      if (typeof m.toolCalls === "string") {
        try { return JSON.parse(m.toolCalls as string); } catch { return []; }
      }
      return m.toolCalls;
    };

    const stats = {
      messageCount: messages.length,
      userMessages: messages.filter((m) => m.role === "user").length,
      assistantMessages: messages.filter((m) => m.role === "assistant").length,
      toolCalls: messages.reduce(
        (sum, m) => sum + (parseToolCalls(m).length || 0),
        0
      ),
      totalTokens: messages.reduce(
        (sum, m) => sum + (parseMetadata(m).tokens || 0),
        0
      ),
      averageLatency:
        messages.reduce((sum, m) => sum + (parseMetadata(m).latency || 0), 0) /
        (messages.length || 1),
    };

    return stats;
  }
}
