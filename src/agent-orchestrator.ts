import type { MySql2Database } from "drizzle-orm/mysql2";
import { invokeLLM, type Message, type ToolCall } from "./llm";
import type { ProjectDbPool } from "./project-db-wrapper";
import { ConversationManager } from "./conversation-manager";
import { ToolExecutor, type ToolExecutionContext } from "./tool-executor";
import { LearningEngine } from "./learning-engine";
import { queryTools } from "./tools/query-tools";
import { generationTools } from "./tools/generation-tools";
import { workflowTools } from "./tools/workflow-tools";
import { allModificationTools } from "./tools/modification-tools";
import { intelligenceTools } from "./tools/intelligence-tools";
import { knowledgeBaseTools } from "./tools/knowledge-base-tools";
import { KnowledgeExtractor } from "./knowledge-extractor";

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
  projectId?: number;
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
  public knowledgeExtractor: KnowledgeExtractor;

  constructor(
    private db: MySql2Database<any>,
    private getProjectDb: (projectId: number) => Promise<ProjectDbPool>
  ) {
    this.conversationManager = new ConversationManager(db);
    this.toolExecutor = new ToolExecutor(db);
    this.learningEngine = new LearningEngine(db);
    this.knowledgeExtractor = new KnowledgeExtractor(db);

    // Register all available tools
    this.toolExecutor.registerTools([...queryTools, ...generationTools, ...workflowTools, ...allModificationTools, ...intelligenceTools, ...knowledgeBaseTools]);
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

      // Get project database connection (only if projectId is provided)
      const projectDb = request.projectId
        ? await this.getProjectDb(request.projectId)
        : null;

      // Build system prompt with context
      const systemPrompt = await this.buildSystemPrompt(request);

      // Prepare messages for LLM
      // IMPORTANT: Preserve full message structure including tool_calls and tool_call_id
      // to maintain valid OpenAI message sequences
      const messages: Message[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...history.map((msg) => {
          const m: any = {
            role: msg.role,
            content: msg.content,
          };
          // Preserve tool_calls on assistant messages
          if (msg.tool_calls) {
            m.tool_calls = msg.tool_calls;
            m.content = msg.content || null;
          }
          // Preserve tool_call_id on tool messages
          if (msg.tool_call_id) {
            m.tool_call_id = msg.tool_call_id;
          }
          return m;
        }),
      ];

      // Get available tools
      const tools = this.toolExecutor.getToolDefinitions();
      console.log("[AGENT DEBUG] Tools registered:", tools.length);
      console.log("[AGENT DEBUG] Tool names:", tools.map((t: any) => t.function.name));

      // ============================================================
      // MULTI-TURN TOOL CALLING LOOP
      // The agent can iterate up to MAX_TOOL_ROUNDS times, calling
      // tools and reasoning about results before generating its
      // final response. This enables multi-step analysis:
      // e.g., query facts → cross-reference → validate → synthesize
      // ============================================================
      const MAX_TOOL_ROUNDS = 5;
      let responseContent = "";
      const toolCallResults: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        result: unknown;
      }> = [];
      let totalTokens = 0;
      let modelUsed = "";

      const executionContext: ToolExecutionContext = {
        userId: request.userId,
        projectId: request.projectId,
        conversationId,
        db: this.db,
        mainDb: this.db, // Alias for narrative tools
        projectDb: projectDb || undefined,
      };

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        console.log(`[AGENT] Tool calling round ${round + 1}/${MAX_TOOL_ROUNDS}`);

        // Call LLM with tool calling capability
        const llmResponse = await invokeLLM({
          messages,
          tools,
          toolChoice: "auto",
          maxTokens: 8000,
        });

        // Track token usage
        if (llmResponse.usage) {
          totalTokens += llmResponse.usage.total_tokens;
        }
        modelUsed = llmResponse.model || modelUsed;

        // Validate LLM response
        if (!llmResponse || !llmResponse.choices || llmResponse.choices.length === 0) {
          throw new Error("Invalid LLM response: missing choices array");
        }

        const assistantMessage = llmResponse.choices[0]?.message;
        if (!assistantMessage) {
          throw new Error("Invalid LLM response: missing message in choices[0]");
        }

        // Extract text content from the response
        const messageContent = typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : Array.isArray(assistantMessage.content)
            ? assistantMessage.content.map((p: any) => typeof p === "string" ? p : p?.text || "").join("")
            : String(assistantMessage.content || "");

        // If no tool calls, this is the final response — break out of the loop
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          responseContent = messageContent;
          console.log(`[AGENT] No more tool calls after round ${round + 1}. Final response ready.`);
          break;
        }

        // === TOOL CALLS DETECTED — EXECUTE THEM ===
        console.log(`[AGENT] Round ${round + 1}: ${assistantMessage.tool_calls.length} tool call(s): ${assistantMessage.tool_calls.map((tc: ToolCall) => tc.function.name).join(", ")}`);

        // Add the assistant message with tool_calls to the in-memory messages array
        messages.push({
          role: "assistant",
          content: assistantMessage.content || null,
          tool_calls: assistantMessage.tool_calls,
        } as any);

        // Save the intermediate assistant message (with tool_calls) to the database
        const toolCallsForDb = assistantMessage.tool_calls.map((tc: ToolCall) => {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          };
        });

        await this.conversationManager.addMessage({
          conversationId,
          role: "assistant",
          content: messageContent || "",
          toolCalls: toolCallsForDb,
          metadata: {
            tokens: llmResponse.usage?.total_tokens,
            model: llmResponse.model,
            latency: Date.now() - startTime,
          },
        });

        // CRITICAL: Small delay to ensure message ordering in database
        await new Promise(resolve => setTimeout(resolve, 100));

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          let args: Record<string, unknown>;
          try {
            args = typeof toolCall.function.arguments === "string"
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
          } catch (parseError) {
            console.error(`Failed to parse tool call arguments for ${toolCall.function.name}:`, parseError);
            args = {};
          }
          console.log(`[AGENT] Executing tool: ${toolCall.function.name}`, JSON.stringify(args));
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

          // Add tool result to in-memory messages array
          const toolContent = result.result != null 
            ? JSON.stringify(result.result)
            : JSON.stringify({ error: "Tool returned no result" });
          
          messages.push({
            role: "tool",
            content: toolContent,
            tool_call_id: toolCall.id,
          } as any);

          // Save tool response to database for conversation history
          await this.conversationManager.addMessage({
            conversationId,
            role: "tool",
            content: toolContent,
            toolCallId: toolCall.id,
          });
        }

        // If this is the last allowed round, force a final response without tools
        if (round === MAX_TOOL_ROUNDS - 1) {
          console.log(`[AGENT] Max tool rounds reached. Forcing final response.`);
          const finalResponse = await invokeLLM({
            messages,
            maxTokens: 8000,
          });

          if (finalResponse?.choices?.[0]?.message) {
            const finalMsg = finalResponse.choices[0].message;
            responseContent = typeof finalMsg.content === "string"
              ? finalMsg.content
              : Array.isArray(finalMsg.content)
                ? finalMsg.content.map((p: any) => typeof p === "string" ? p : p?.text || "").join("")
                : String(finalMsg.content || "");
            if (finalResponse.usage) totalTokens += finalResponse.usage.total_tokens;
          }
        }
      }

      // Save the final assistant response to conversation
      await this.conversationManager.addMessage({
        conversationId,
        role: "assistant",
        content: responseContent || "I apologize, but I was unable to generate a response.",
        metadata: {
          tokens: totalTokens,
          model: modelUsed,
          latency: Date.now() - startTime,
        },
      });

      console.log(`[AGENT] Complete. ${toolsUsed.length} tool calls across conversation. Total tokens: ${totalTokens}. Latency: ${Date.now() - startTime}ms`);

      // Fire-and-forget: Extract knowledge from this conversation asynchronously
      // This doesn't block the response — it runs in the background
      if (toolCallResults.length > 0) {
        this.knowledgeExtractor.extractFromConversation({
          projectId: request.projectId,
          userMessage: request.message,
          agentResponse: responseContent,
          toolResults: toolCallResults.map(tc => ({
            name: tc.name,
            result: tc.result,
          })),
        }).catch(err => console.error("[KNOWLEDGE EXTRACTOR] Background extraction failed:", err));
      }

      return {
        conversationId,
        message: responseContent,
        toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined,
        metadata: {
          tokens: totalTokens,
          model: modelUsed,
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
   * Injects relevant knowledge base entries to make the agent smarter over time
   */
  private async buildSystemPrompt(request: AgentRequest): Promise<string> {
    let prompt = `You are a senior renewable energy due diligence analyst with 15+ years of experience in solar PV project assessment. You work within the OE (Operational Excellence) platform, helping users analyze project data, identify risks, and produce investment-grade due diligence reports.

You think like an experienced technical advisor — not a search engine. When a user asks a question, you don't just retrieve data; you analyze it, cross-reference it, validate it against industry norms, and flag anything that looks unusual.

## YOUR ANALYTICAL APPROACH

For every query, follow this reasoning process:

1. RETRIEVE: Use tools to pull relevant facts from the database. Cast a wide net — if asked about capacity, also pull related facts like area, technology, yield, and DC/AC ratio.

2. CROSS-REFERENCE: Look for relationships and contradictions between facts. Do the numbers add up? Does the DC capacity match the site area? Does the technology match the stated performance?

3. VALIDATE: Check facts against your domain knowledge. Flag anything outside normal ranges. If a solar project in Oman claims a capacity factor of 15%, that's suspiciously low. If CAPEX is $0.30/Wp for a utility-scale project, that needs verification.

4. SYNTHESIZE: Don't just list facts — tell the user what they mean. Connect the dots. "The project has 300 MWp DC on 250 hectares, giving a power density of 1.2 MW/ha, which is typical for single-axis tracker installations in arid regions."

5. FLAG GAPS: Proactively identify what's missing. "I notice we have capacity and area data but no module specification or inverter details. These would be needed for a complete technical assessment."

## DOMAIN KNOWLEDGE — SOLAR PV BENCHMARKS

Use these ranges to validate facts (flag values outside these as needing verification):

| Metric | Typical Range | Notes |
|--------|--------------|-------|
| DC/AC Ratio | 1.15 – 1.40 | Below 1.1 is conservative, above 1.5 is aggressive |
| Capacity Factor (MENA) | 20% – 28% | Oman/UAE typically 22-26% |
| Capacity Factor (Europe) | 10% – 18% | Southern Europe higher |
| Specific Yield (MENA) | 1,700 – 2,200 kWh/kWp | Depends on tracking |
| Power Density (fixed tilt) | 0.8 – 1.2 MW/ha | |
| Power Density (tracker) | 0.6 – 1.0 MW/ha | Single-axis trackers need more space |
| CAPEX Utility Solar | $0.50 – $1.00/Wp | Varies by region and year |
| Module Degradation | 0.4% – 0.7%/year | Bifacial may differ |
| PR (Performance Ratio) | 75% – 85% | Higher with modern tech |
| Availability | 97% – 99.5% | Contractual vs actual |
| Grid Losses | 1% – 5% | Depends on distance |
| Inverter Efficiency | 97% – 99% | |

## HOW TO RESPOND

- When presenting facts, always include the source confidence level and whether the fact is verified.
- When you spot a potential issue, frame it as: "This warrants verification because..." rather than "This is wrong."
- When facts contradict each other, present both and explain the discrepancy.
- When data is missing, suggest what documents might contain it.
- Always provide context — don't just say "DC Capacity is 300 MWp". Say "DC Capacity is 300 MWp (AC: 280 MW, DC/AC ratio: 1.07). Note: This DC/AC ratio of 1.07 is below the typical range of 1.15-1.40, which may indicate conservative design or a potential data entry issue. Worth verifying against the technical design documents."
- When generating overviews or reports, structure them professionally with clear sections, and always include a "Key Observations" or "Items Requiring Attention" section.

## TOOL USAGE STRATEGY

You have access to tools for querying facts, documents, red flags, and project summaries. Use them strategically:

- Start with get_project_summary or list_fact_categories to understand what data exists before diving into specifics.
- Use query_facts with broad searches first, then narrow down. Search by category AND by searchTerm for comprehensive coverage.
- When asked about a specific topic, query multiple related categories. For example, if asked about "grid connection", search for facts in Technical_Design, Dependencies, and Risks_And_Issues.
- After retrieving facts, use query_red_flags to check if there are any risks related to the topic.
- Cross-reference document sources — if two facts from different documents contradict, note which documents they came from.

## RESPONSE QUALITY

- Be thorough but not verbose. Quality over quantity.
- Use professional due diligence language.
- Structure responses with clear headings when appropriate.
- Include specific numbers and cite the data source (document ID, confidence level).
- End complex responses with a brief summary of key findings and recommended next steps.
- If you're uncertain about something, say so explicitly rather than guessing.

## KNOWLEDGE BASE

You have a persistent knowledge base that accumulates insights across all projects. ALWAYS use the search_knowledge_base tool when you need domain-specific information. You can also add new knowledge using add_knowledge when you discover generalizable insights during analysis.

The knowledge base contains:
- Industry benchmarks and standards
- Regional regulatory patterns
- Lessons learned from previous project analyses
- Best practices for due diligence
- Technical standards and specifications

When you discover something new and generalizable during analysis (e.g., a regional pattern, a useful benchmark, a common risk), proactively add it to the knowledge base so it's available for future projects.

Current context:
${request.projectId ? `- Project ID: ${request.projectId}` : '- Mode: Global knowledge base query (no specific project selected)'}
- User ID: ${request.userId}
${!request.projectId ? '\nIMPORTANT: No project is selected. You cannot query project-specific facts, documents, or red flags. Focus on the global knowledge base, general domain knowledge, and cross-project insights. If the user asks about specific project data, let them know they need to select a project first.' : ''}`;

    if (request.context?.currentPage) {
      prompt += `\n- Current page: ${request.context.currentPage}`;
    }
    if (request.context?.workflowStage) {
      prompt += `\n- Workflow stage: ${request.context.workflowStage}`;
    }

    // Inject high-confidence knowledge base entries into the system prompt
    // This gives the agent immediate access to accumulated knowledge without tool calls
    try {
      const { agentKnowledgeBase } = await import("./schema");
      const { desc, eq } = await import("drizzle-orm");
      
      const topKnowledge = await this.db
        .select({
          topic: agentKnowledgeBase.topic,
          content: agentKnowledgeBase.content,
          category: agentKnowledgeBase.category,
          confidence: agentKnowledgeBase.confidence,
          sourceCount: agentKnowledgeBase.sourceCount,
        })
        .from(agentKnowledgeBase)
        .orderBy(desc(agentKnowledgeBase.sourceCount))
        .limit(15);

      if (topKnowledge.length > 0) {
        prompt += `\n\n## ACCUMULATED KNOWLEDGE (from previous analyses)\n\n`;
        prompt += `The following insights have been accumulated from previous project analyses. Use them to inform your responses:\n\n`;
        for (const entry of topKnowledge) {
          prompt += `**${entry.topic}** (${entry.category}, ${entry.confidence} confidence, ${entry.sourceCount} source(s)):\n${entry.content}\n\n`;
        }
      }
    } catch (error) {
      console.error("[SYSTEM PROMPT] Failed to inject knowledge base:", error);
    }

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
  async getConversations(userId: number, projectId?: number) {
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
