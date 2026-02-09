import type { MySql2Database } from "drizzle-orm/mysql2";
import type { ProjectDbPool } from "./project-db-wrapper";
import { z } from "zod";
import { AgentOrchestrator } from "./agent-orchestrator";

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
  getDb: () => MySql2Database<any>;
  
  /**
   * Function to create a project-specific database connection
   */
  createProjectDbConnection: (projectId: number) => Promise<ProjectDbPool>;
}

/**
 * Factory function to create the agent tRPC router
 * 
 * This allows the consuming application to provide its own tRPC setup and database connections
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

  return router({
    /**
     * Send a message to the agent and get a response
     */
    chat: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          message: z.string(),
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
        const db = getDb();
        const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

        return await orchestrator.processMessage({
          userId: ctx.user.id,
          projectId: input.projectId,
          message: input.message,
          conversationId: input.conversationId,
          context: input.context,
        });
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
      .query(async ({ input, ctx }: any) => {
        const db = getDb();
        const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

        return await orchestrator.conversationManager.getConversation(
          input.conversationId
        );
      }),

    /**
     * List all conversations for a project
     */
    listConversations: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          limit: z.number().optional().default(50),
        })
      )
      .query(async ({ input, ctx }: any) => {
        const db = getDb();
        const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

        return await orchestrator.conversationManager.getConversations(
          ctx.user.id,
          input.projectId,
          input.limit
        );
      }),

    /**
     * Provide feedback on generated content
     */
    provideFeedback: protectedProcedure
      .input(
        z.object({
          contentId: z.string(),
          finalContent: z.string(),
          feedback: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }: any) => {
        const db = getDb();
        const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

        await orchestrator.learningEngine.submitEdit(
          input.contentId,
          input.finalContent,
          input.feedback
        );

        return { success: true };
      }),

    /**
     * Get learning statistics for the current user
     */
    getLearningStats: protectedProcedure.query(async ({ ctx }: any) => {
      const db = getDb();
      const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

      return await orchestrator.learningEngine.getLearningStats(ctx.user.id);
    }),

    /**
     * Get available tools
     */
    getTools: protectedProcedure.query(async ({ ctx }: any) => {
      const db = getDb();
      const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

      return orchestrator.toolExecutor.getToolDefinitions();
    }),
  });
}
