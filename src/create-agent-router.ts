import type { MySql2Database } from "drizzle-orm/mysql2";
import type { ProjectDbPool } from "./project-db-wrapper";
import { z } from "zod";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { AgentOrchestrator } from "./agent-orchestrator";
import {
  agentKnowledgeBase,
  agentConversations,
  agentMessages,
  agentActions,
  agentLearningSamples,
  agentGeneratedContent,
} from "./schema";
import { seedKnowledgeBase } from "./seed-knowledge-base";

/**
 * Dependencies required to create the agent router
 */
export interface AgentRouterDependencies {
  /**
   * tRPC router factory function
   */
  router: any;

  /**
   * tRPC protected procedure (with authentication)
   */
  protectedProcedure: any;

  /**
   * Function to get the main database instance
   */
  getDb: () => Promise<MySql2Database<any>>;

  /**
   * Function to create a project-specific database connection
   */
  createProjectDbConnection: (projectId: number) => Promise<ProjectDbPool>;
}

/**
 * Factory function to create the agent tRPC router
 *
 * This allows the consuming application to provide its own tRPC setup and database connections.
 * Includes all endpoints for chat, conversations, knowledge base CRUD, learning stats, and more.
 *
 * @example
 * ```typescript
 * import { createAgentRouter } from '@oe-ecosystem/ai-agent';
 * import { router, protectedProcedure } from './trpc';
 * import { getDb } from './db';
 * import { createProjectDbConnection } from './db-connection';
 *
 * export const agentRouter = createAgentRouter({
 *   router,
 *   protectedProcedure,
 *   getDb,
 *   createProjectDbConnection,
 * });
 * ```
 */
export function createAgentRouter(deps: AgentRouterDependencies) {
  const { router, protectedProcedure, getDb, createProjectDbConnection } = deps;

  // Lazy-initialized orchestrator (created once, reused across requests)
  let orchestrator: AgentOrchestrator | null = null;

  async function getOrchestrator(): Promise<AgentOrchestrator> {
    if (!orchestrator) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      orchestrator = new AgentOrchestrator(db, createProjectDbConnection);
    }
    return orchestrator;
  }

  return router({
    // ============================================================
    // CHAT & CONVERSATION ENDPOINTS
    // ============================================================

    /**
     * Send a message to the agent and get a response
     */
    chat: protectedProcedure
      .input(
        z.object({
          projectId: z.number().optional(),
          message: z.string().min(1),
          conversationId: z.string().optional(),
          context: z
            .object({
              currentPage: z.string().optional(),
              workflowStage: z.string().optional(),
              relevantDocuments: z.array(z.string()).optional(),
              relevantFacts: z.array(z.string()).optional(),
            })
            .optional(),
        })
      )
      .mutation(async ({ input, ctx }: any) => {
        const agent = await getOrchestrator();

        return await agent.processMessage({
          userId: ctx.user.id,
          projectId: input.projectId,
          message: input.message,
          conversationId: input.conversationId,
          context: input.context,
        });
      }),

    /**
     * Quick query - one-off question without conversation context
     */
    quickQuery: protectedProcedure
      .input(
        z.object({
          projectId: z.number().optional(),
          query: z.string(),
        })
      )
      .mutation(async ({ input, ctx }: any) => {
        const agent = await getOrchestrator();

        const response = await agent.processMessage({
          userId: ctx.user.id,
          projectId: input.projectId,
          message: input.query,
        });

        return {
          answer: response.message,
          toolsUsed: response.metadata.toolsUsed,
        };
      }),

    /**
     * Get conversation history
     */
    getConversation: protectedProcedure
      .input(
        z.object({
          conversationId: z.string(),
        })
      )
      .query(async ({ input }: any) => {
        const agent = await getOrchestrator();
        const messages = await agent.conversationManager.getMessages(input.conversationId);
        return { messages };
      }),

    /**
     * List all conversations for a project
     */
    getConversations: protectedProcedure
      .input(
        z.object({
          projectId: z.number().optional(),
          limit: z.number().optional().default(50),
        })
      )
      .query(async ({ input, ctx }: any) => {
        const agent = await getOrchestrator();
        const conversations = await agent.conversationManager.getConversations(
          ctx.user.id,
          input.projectId,
          input.limit
        );
        return { conversations };
      }),

    /**
     * Archive a conversation
     */
    archiveConversation: protectedProcedure
      .input(
        z.object({
          conversationId: z.string(),
        })
      )
      .mutation(async ({ input }: any) => {
        const agent = await getOrchestrator();
        await agent.conversationManager.archiveConversation(input.conversationId);
        return { success: true };
      }),

    /**
     * Delete a conversation
     */
    deleteConversation: protectedProcedure
      .input(
        z.object({
          conversationId: z.string(),
        })
      )
      .mutation(async ({ input }: any) => {
        const agent = await getOrchestrator();
        await agent.conversationManager.deleteConversation(input.conversationId);
        return { success: true };
      }),

    /**
     * Get conversation statistics
     */
    getConversationStats: protectedProcedure
      .input(
        z.object({
          conversationId: z.string(),
        })
      )
      .query(async ({ input }: any) => {
        const agent = await getOrchestrator();
        return await agent.conversationManager.getConversationStats(input.conversationId);
      }),

    /**
     * Get project summary (quick overview via agent)
     */
    getProjectSummary: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
        })
      )
      .query(async ({ input, ctx }: any) => {
        const agent = await getOrchestrator();

        const response = await agent.processMessage({
          userId: ctx.user.id,
          projectId: input.projectId,
          message: "Give me a quick summary of this project including document count, fact count, and key risks.",
        });

        return {
          summary: response.message,
          metadata: response.metadata,
        };
      }),

    // ============================================================
    // LEARNING & STYLE ENDPOINTS
    // ============================================================

    /**
     * Submit user edit for learning
     */
    submitEdit: protectedProcedure
      .input(
        z.object({
          contentId: z.string(),
          finalContent: z.string(),
          feedback: z.string().optional(),
        })
      )
      .mutation(async ({ input }: any) => {
        const agent = await getOrchestrator();
        await agent.learningEngine.submitEdit(
          input.contentId,
          input.finalContent,
          input.feedback
        );
        return { success: true };
      }),

    /**
     * Provide feedback on generated content (alias for submitEdit)
     */
    provideFeedback: protectedProcedure
      .input(
        z.object({
          contentId: z.string(),
          finalContent: z.string(),
          feedback: z.string().optional(),
        })
      )
      .mutation(async ({ input }: any) => {
        const agent = await getOrchestrator();
        await agent.learningEngine.submitEdit(
          input.contentId,
          input.finalContent,
          input.feedback
        );
        return { success: true };
      }),

    /**
     * Get user's style model
     */
    getStyleModel: protectedProcedure.query(async ({ ctx }: any) => {
      const agent = await getOrchestrator();
      const styleModel = await agent.learningEngine.getStyleModel(ctx.user.id);
      return { styleModel };
    }),

    /**
     * Get learning statistics for the current user
     */
    getLearningStats: protectedProcedure.query(async ({ ctx }: any) => {
      const agent = await getOrchestrator();
      return await agent.learningEngine.getLearningStats(ctx.user.id);
    }),

    /**
     * Get available tools
     */
    getTools: protectedProcedure.query(async () => {
      const agent = await getOrchestrator();
      return agent.toolExecutor.getToolDefinitions();
    }),

    // ============================================================
    // KNOWLEDGE BASE ENDPOINTS
    // ============================================================

    /**
     * List all knowledge base entries with optional filtering
     */
    listKnowledge: protectedProcedure
      .input(
        z.object({
          category: z.string().optional(),
          search: z.string().optional(),
          confidence: z.string().optional(),
          limit: z.number().optional().default(50),
          offset: z.number().optional().default(0),
        })
      )
      .query(async ({ input }: any) => {
        const db = await getDb();

        const conditions: any[] = [];
        if (input.category) {
          conditions.push(eq(agentKnowledgeBase.category, input.category));
        }
        if (input.confidence) {
          conditions.push(eq(agentKnowledgeBase.confidence, input.confidence));
        }
        if (input.search) {
          conditions.push(
            sql`(LOWER(${agentKnowledgeBase.topic}) LIKE ${`%${input.search.toLowerCase()}%`} OR LOWER(${agentKnowledgeBase.content}) LIKE ${`%${input.search.toLowerCase()}%`})`
          );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const entries = await db
          .select()
          .from(agentKnowledgeBase)
          .where(whereClause)
          .orderBy(desc(agentKnowledgeBase.updatedAt))
          .limit(input.limit)
          .offset(input.offset);

        const [countResult] = await db
          .select({ total: count() })
          .from(agentKnowledgeBase)
          .where(whereClause);

        return {
          entries,
          total: countResult?.total || 0,
        };
      }),

    /**
     * Get a single knowledge base entry by ID
     */
    getKnowledge: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }: any) => {
        const db = await getDb();

        const [entry] = await db
          .select()
          .from(agentKnowledgeBase)
          .where(eq(agentKnowledgeBase.id, input.id));

        if (!entry) throw new Error("Knowledge entry not found");
        return entry;
      }),

    /**
     * Create a new knowledge base entry
     */
    createKnowledge: protectedProcedure
      .input(
        z.object({
          category: z.string(),
          topic: z.string().min(1),
          content: z.string().min(1),
          confidence: z.string().default("medium"),
          tags: z.array(z.string()).optional(),
          relatedTopics: z.array(z.string()).optional(),
          applicability: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ input }: any) => {
        const db = await getDb();

        const id = uuidv4();
        await db.insert(agentKnowledgeBase).values({
          id,
          category: input.category,
          topic: input.topic,
          content: input.content,
          confidence: input.confidence,
          sourceCount: 1,
          metadata: {
            tags: input.tags || [],
            relatedTopics: input.relatedTopics || [],
            applicability: input.applicability || [],
          },
        });

        return { id, success: true };
      }),

    /**
     * Update a knowledge base entry
     */
    updateKnowledge: protectedProcedure
      .input(
        z.object({
          id: z.string(),
          category: z.string().optional(),
          topic: z.string().optional(),
          content: z.string().optional(),
          confidence: z.string().optional(),
          tags: z.array(z.string()).optional(),
          relatedTopics: z.array(z.string()).optional(),
          applicability: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ input }: any) => {
        const db = await getDb();

        const { id, tags, relatedTopics, applicability, ...fields } = input;

        const updates: any = {};
        if (fields.category) updates.category = fields.category;
        if (fields.topic) updates.topic = fields.topic;
        if (fields.content) updates.content = fields.content;
        if (fields.confidence) updates.confidence = fields.confidence;

        if (tags || relatedTopics || applicability) {
          const [existing] = await db
            .select({ metadata: agentKnowledgeBase.metadata })
            .from(agentKnowledgeBase)
            .where(eq(agentKnowledgeBase.id, id));

          const existingMeta = (existing?.metadata || {}) as any;
          updates.metadata = {
            tags: tags || existingMeta.tags || [],
            relatedTopics: relatedTopics || existingMeta.relatedTopics || [],
            applicability: applicability || existingMeta.applicability || [],
          };
        }

        await db
          .update(agentKnowledgeBase)
          .set(updates)
          .where(eq(agentKnowledgeBase.id, id));

        return { success: true };
      }),

    /**
     * Delete a knowledge base entry
     */
    deleteKnowledge: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }: any) => {
        const db = await getDb();

        await db
          .delete(agentKnowledgeBase)
          .where(eq(agentKnowledgeBase.id, input.id));

        return { success: true };
      }),

    /**
     * Seed the knowledge base with foundational data
     */
    seedKnowledge: protectedProcedure
      .mutation(async () => {
        const db = await getDb();
        const result = await seedKnowledgeBase(db);
        return result;
      }),

    // ============================================================
    // STATS & ANALYTICS ENDPOINTS
    // ============================================================

    /**
     * Get comprehensive knowledge and activity statistics
     */
    getKnowledgeStats: protectedProcedure
      .query(async () => {
        const db = await getDb();

        // Knowledge base stats
        const allKnowledge = await db
          .select({
            category: agentKnowledgeBase.category,
            confidence: agentKnowledgeBase.confidence,
            sourceCount: agentKnowledgeBase.sourceCount,
            createdAt: agentKnowledgeBase.createdAt,
          })
          .from(agentKnowledgeBase);

        const byCategory: Record<string, number> = {};
        const byConfidence: Record<string, number> = {};
        let totalSourceCount = 0;

        for (const entry of allKnowledge) {
          byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
          byConfidence[entry.confidence || "medium"] = (byConfidence[entry.confidence || "medium"] || 0) + 1;
          totalSourceCount += entry.sourceCount || 1;
        }

        // Conversation stats
        const [conversationCount] = await db
          .select({ total: count() })
          .from(agentConversations);

        // Message stats
        const [messageCount] = await db
          .select({ total: count() })
          .from(agentMessages);

        // Action stats
        const [actionCount] = await db
          .select({ total: count() })
          .from(agentActions);

        // Learning samples stats
        const [sampleCount] = await db
          .select({ total: count() })
          .from(agentLearningSamples);

        // Generated content stats
        const [generatedCount] = await db
          .select({ total: count() })
          .from(agentGeneratedContent);

        // Recent knowledge entries (last 10)
        const recentKnowledge = await db
          .select({
            id: agentKnowledgeBase.id,
            topic: agentKnowledgeBase.topic,
            category: agentKnowledgeBase.category,
            confidence: agentKnowledgeBase.confidence,
            sourceCount: agentKnowledgeBase.sourceCount,
            createdAt: agentKnowledgeBase.createdAt,
            updatedAt: agentKnowledgeBase.updatedAt,
          })
          .from(agentKnowledgeBase)
          .orderBy(desc(agentKnowledgeBase.updatedAt))
          .limit(10);

        // Top knowledge by source count (most validated)
        const topKnowledge = await db
          .select({
            id: agentKnowledgeBase.id,
            topic: agentKnowledgeBase.topic,
            category: agentKnowledgeBase.category,
            confidence: agentKnowledgeBase.confidence,
            sourceCount: agentKnowledgeBase.sourceCount,
          })
          .from(agentKnowledgeBase)
          .orderBy(desc(agentKnowledgeBase.sourceCount))
          .limit(10);

        return {
          knowledge: {
            totalEntries: allKnowledge.length,
            byCategory,
            byConfidence,
            averageSourceCount: allKnowledge.length > 0 ? totalSourceCount / allKnowledge.length : 0,
            recentEntries: recentKnowledge,
            topEntries: topKnowledge,
          },
          activity: {
            totalConversations: conversationCount?.total || 0,
            totalMessages: messageCount?.total || 0,
            totalActions: actionCount?.total || 0,
            totalLearningSamples: sampleCount?.total || 0,
            totalGeneratedContent: generatedCount?.total || 0,
          },
        };
      }),
  });
}
