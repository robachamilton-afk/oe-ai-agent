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
  projectId: number;
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
      projectId: params.projectId,
      title: params.title || `Conversation ${new Date().toISOString()}`,
      context: params.context || {},
      status: "active",
    };

    await this.db.insert(agentConversations).values(conversation);

    const [created] = await this.db
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.id, conversationId));

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
    projectId: number,
    limit: number = 50
  ): Promise<AgentConversation[]> {
    return await this.db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.userId, userId),
          eq(agentConversations.projectId, projectId)
        )
      )
      .orderBy(desc(agentConversations.updatedAt))
      .limit(limit);
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(params: AddMessageParams): Promise<AgentMessage> {
    const messageId = uuidv4();
    const message: InsertAgentMessage = {
      id: messageId,
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      toolCalls: params.toolCalls,
      metadata: params.metadata,
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
      .orderBy(agentMessages.createdAt)
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
      .orderBy(desc(agentMessages.createdAt))
      .limit(count);

    return messages.reverse(); // Return in chronological order
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

    const updatedContext = {
      ...(conversation.context || {}),
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
   * Build conversation history for LLM context
   */
  async buildLLMContext(
    conversationId: string,
    maxMessages: number = 20
  ): Promise<Array<{ role: string; content: string }>> {
    const messages = await this.getRecentMessages(conversationId, maxMessages);

    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
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

    const stats = {
      messageCount: messages.length,
      userMessages: messages.filter((m) => m.role === "user").length,
      assistantMessages: messages.filter((m) => m.role === "assistant").length,
      toolCalls: messages.reduce(
        (sum, m) => sum + (m.toolCalls?.length || 0),
        0
      ),
      totalTokens: messages.reduce(
        (sum, m) => sum + (m.metadata?.tokens || 0),
        0
      ),
      averageLatency:
        messages.reduce((sum, m) => sum + (m.metadata?.latency || 0), 0) /
        (messages.length || 1),
    };

    return stats;
  }
}
