import type { MySql2Database } from "drizzle-orm/mysql2";
import { invokeLLM, type Message, type ToolCall } from "./llm";
import type { ProjectDbPool } from "./project-db-wrapper";
import { ConversationManager } from "./conversation-manager";
import { ToolExecutor, type ToolExecutionContext } from "./tool-executor";
import { LearningEngine } from "./learning-engine";
import { queryTools } from "./tools/query-tools";
import { generationTools } from "./tools/generation-tools";
import { workflowTools } from "./tools/workflow-tools";

/**
 * Agent Orchestrator
 * 
 * Main coordinator that brings together all agent components:
 * - Conversation management
 * - LLM interaction
 * - Tool execution
 * - Learning and adaptation
 */

export interface AgentRequest {
  userId: number;
  projectId: number;
  conversationId?: string;
  message: string;
  context?: {
    currentPage?: string;
    workflowStage?: string;
    relevantDocuments?: string[];
    relevantFacts?: string[];
  };
}

export interface AgentResponse {
  conversationId: string;
  message: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
  }>;
  metadata: {
    tokens?: number;
    model?: string;
    latency: number;
    toolsUsed: string[];
  };
}

export class AgentOrchestrator {
  public conversationManager: ConversationManager;
  public toolExecutor: ToolExecutor;
  public learningEngine: LearningEngine;

  constructor(
    private db: MySql2Database<any>,
    private getProjectDb: (projectId: number) => Promise<ProjectDbPool>
  ) {
    this.conversationManager = new ConversationManager(db);
    this.toolExecutor = new ToolExecutor(db);
    this.learningEngine = new LearningEngine(db);

    // Register all available tools
    this.toolExecutor.registerTools([...queryTools, ...generationTools, ...workflowTools]);
  }

  /**
   * Process a user message and generate a response
   */
  async processMessage(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];

    try {
      // Get or create conversation
      let conversationId = request.conversationId;
      if (!conversationId) {
        const conversation = await this.conversationManager.createConversation({
          userId: request.userId,
          projectId: request.projectId,
          context: request.context,
        });
        conversationId = conversation.id;
      }

      // Update context if provided
      if (request.context) {
        await this.conversationManager.updateContext(conversationId, request.context);
      }

      // Add user message to conversation
      await this.conversationManager.addMessage({
        conversationId,
        role: "user",
        content: request.message,
      });

      // Get conversation history for context
      const history = await this.conversationManager.buildLLMContext(conversationId);

      // Get project database connection
      const projectDb = await this.getProjectDb(request.projectId);

      // Build system prompt with context
      const systemPrompt = this.buildSystemPrompt(request);

      // Prepare messages for LLM
      const messages: Message[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...history.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        })),
      ];

      // Get available tools
      const tools = this.toolExecutor.getToolDefinitions();

      // Call LLM with tool calling capability
      const llmResponse = await invokeLLM({
        messages,
        tools,
        toolChoice: "auto",
        maxTokens: 4000,
      });

      const assistantMessage = llmResponse.choices[0].message;
      let responseContent = assistantMessage.content as string;
      const toolCallResults: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        result: unknown;
      }> = [];

      // Execute tool calls if any
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Add the assistant message with tool_calls to the conversation
        messages.push({
          role: "assistant",
          content: assistantMessage.content || null,
          tool_calls: assistantMessage.tool_calls,
        } as any);

        const executionContext: ToolExecutionContext = {
          userId: request.userId,
          projectId: request.projectId,
          conversationId,
          db: this.db,
          projectDb,
        };

        for (const toolCall of assistantMessage.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await this.toolExecutor.executeTool(
            toolCall.function.name,
            args,
            executionContext
          );

          toolsUsed.push(toolCall.function.name);
          toolCallResults.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: args,
            result: result.result,
          });

          // Add tool result to conversation
          messages.push({
            role: "tool",
            content: JSON.stringify(result.result),
            tool_call_id: toolCall.id,
          } as any);
        }

        // Get final response after tool execution
        const finalResponse = await invokeLLM({
          messages,
          maxTokens: 2000,
        });

        responseContent = finalResponse.choices[0].message.content as string;
      }

      // Save assistant response to conversation
      await this.conversationManager.addMessage({
        conversationId,
        role: "assistant",
        content: responseContent,
        toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined,
        metadata: {
          tokens: llmResponse.usage?.total_tokens,
          model: llmResponse.model,
          latency: Date.now() - startTime,
        },
      });

      return {
        conversationId,
        message: responseContent,
        toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined,
        metadata: {
          tokens: llmResponse.usage?.total_tokens,
          model: llmResponse.model,
          latency: Date.now() - startTime,
          toolsUsed,
        },
      };
    } catch (error) {
      console.error("Agent processing error:", error);
      throw error;
    }
  }

  /**
   * Build system prompt with context
   */
  private buildSystemPrompt(request: AgentRequest): string {
    let prompt = `You are an AI assistant for the OE (Operational Excellence) ecosystem, specializing in renewable energy project due diligence and technical advisory.

Your role is to help users:
1. Query and analyze project data (documents, facts, red flags)
2. Generate technical content (reports, risk assessments, specifications)
3. Guide through workflows (project setup, deliverables preparation)
4. Provide expert insights on renewable energy projects

You have access to tools for querying databases, generating content, and analyzing data. Use these tools when appropriate to provide accurate, data-driven responses.

Current context:
- Project ID: ${request.projectId}
- User ID: ${request.userId}`;

    if (request.context?.currentPage) {
      prompt += `\n- Current page: ${request.context.currentPage}`;
    }
    if (request.context?.workflowStage) {
      prompt += `\n- Workflow stage: ${request.context.workflowStage}`;
    }

    prompt += `\n\nBe concise, professional, and technical. When using tools, explain what you're doing and why. When generating content, apply best practices for technical writing in the renewable energy domain.`;

    return prompt;
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(conversationId: string) {
    return await this.conversationManager.getMessages(conversationId);
  }

  /**
   * Get all conversations for a user and project
   */
  async getConversations(userId: number, projectId: number) {
    return await this.conversationManager.getConversations(userId, projectId);
  }

  /**
   * Archive a conversation
   */
  async archiveConversation(conversationId: string) {
    return await this.conversationManager.archiveConversation(conversationId);
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: string) {
    return await this.conversationManager.deleteConversation(conversationId);
  }

  /**
   * Submit user edit for learning
   */
  async submitEdit(contentId: string, finalContent: string, feedback?: string) {
    return await this.learningEngine.submitEdit(contentId, finalContent, feedback);
  }

  /**
   * Get user's style model
   */
  async getStyleModel(userId: number) {
    return await this.learningEngine.getStyleModel(userId);
  }

  /**
   * Get learning statistics
   */
  async getLearningStats(userId: number) {
    return await this.learningEngine.getLearningStats(userId);
  }

  /**
   * Get conversation statistics
   */
  async getConversationStats(conversationId: string) {
    return await this.conversationManager.getConversationStats(conversationId);
  }
}
