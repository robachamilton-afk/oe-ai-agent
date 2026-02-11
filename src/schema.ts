import { mysqlTable, varchar, text, timestamp, int, json, boolean } from "drizzle-orm/mysql-core";

/**
 * Agent Module Database Schema
 * 
 * Tables for managing AI agent conversations, learning, and style adaptation
 */

/**
 * Conversations table - stores multi-turn conversation history
 */
export const agentConversations = mysqlTable("agent_conversations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(),
  projectId: int("project_id").notNull(),
  title: varchar("title", { length: 255 }),
  context: json("context").$type<{
    currentPage?: string;
    workflowStage?: string;
    relevantDocuments?: string[];
    relevantFacts?: string[];
  }>(),
  status: varchar("status", { length: 20 }).default("active"), // active, archived
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/**
 * Messages table - individual messages within conversations
 */
export const agentMessages = mysqlTable("agent_messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }).notNull(),
  role: varchar("role", { length: 20 }).notNull(), // user, assistant, system, tool
  content: text("content").notNull(),
  toolCalls: json("tool_calls").$type<Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>>(),
  toolCallId: varchar("tool_call_id", { length: 100 }),
  metadata: json("metadata").$type<{
    tokens?: number;
    model?: string;
    latency?: number;
    error?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Agent actions log - audit trail of all agent operations
 */
export const agentActions = mysqlTable("agent_actions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }),
  userId: int("user_id").notNull(),
  projectId: int("project_id").notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(), // query, generate, modify, analyze
  actionName: varchar("action_name", { length: 100 }).notNull(),
  input: json("input").$type<Record<string, unknown>>(),
  output: json("output").$type<Record<string, unknown>>(),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  executionTimeMs: int("execution_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Style models - user-specific writing style patterns
 */
export const agentStyleModels = mysqlTable("agent_style_models", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(),
  version: int("version").notNull().default(1),
  patterns: json("patterns").$type<{
    sentenceStructure?: string[];
    technicalDepth?: string;
    riskFraming?: string;
    terminology?: Record<string, string>;
    formatPreferences?: Record<string, string>;
  }>(),
  statistics: json("statistics").$type<{
    totalEdits: number;
    totalGenerations: number;
    averageEditDistance: number;
    improvementScore: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/**
 * Learning samples - draft vs final comparisons for training
 */
export const agentLearningSamples = mysqlTable("agent_learning_samples", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(),
  projectId: int("project_id").notNull(),
  contentType: varchar("content_type", { length: 50 }).notNull(), // risk_narrative, report, specification
  draftContent: text("draft_content").notNull(),
  finalContent: text("final_content").notNull(),
  extractedPatterns: json("extracted_patterns").$type<{
    addedPhrases?: string[];
    removedPhrases?: string[];
    styleChanges?: string[];
    structuralChanges?: string[];
  }>(),
  editDistance: int("edit_distance"),
  applied: boolean("applied").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Shared knowledge base - de-identified cross-project insights
 */
export const agentKnowledgeBase = mysqlTable("agent_knowledge_base", {
  id: varchar("id", { length: 36 }).primaryKey(),
  category: varchar("category", { length: 100 }).notNull(), // domain_knowledge, best_practice, pattern
  topic: varchar("topic", { length: 255 }).notNull(),
  content: text("content").notNull(),
  confidence: varchar("confidence", { length: 20 }).default("medium"), // low, medium, high
  sourceCount: int("source_count").default(1), // Number of projects this was derived from
  metadata: json("metadata").$type<{
    tags?: string[];
    relatedTopics?: string[];
    applicability?: string[];
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/**
 * Generated content tracking - for learning and improvement
 */
export const agentGeneratedContent = mysqlTable("agent_generated_content", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(),
  projectId: int("project_id").notNull(),
  conversationId: varchar("conversation_id", { length: 36 }),
  contentType: varchar("content_type", { length: 50 }).notNull(),
  prompt: text("prompt").notNull(),
  generatedContent: text("generated_content").notNull(),
  finalContent: text("final_content"), // Set when user edits and saves
  accepted: boolean("accepted"), // true if used without edits, false if rejected
  feedback: text("feedback"), // User's explicit feedback
  styleModelVersion: int("style_model_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// Type exports for TypeScript
export type AgentConversation = typeof agentConversations.$inferSelect;
export type InsertAgentConversation = typeof agentConversations.$inferInsert;
export type AgentMessage = typeof agentMessages.$inferSelect;
export type InsertAgentMessage = typeof agentMessages.$inferInsert;
export type AgentAction = typeof agentActions.$inferSelect;
export type InsertAgentAction = typeof agentActions.$inferInsert;
export type AgentStyleModel = typeof agentStyleModels.$inferSelect;
export type InsertAgentStyleModel = typeof agentStyleModels.$inferInsert;
export type AgentLearningSample = typeof agentLearningSamples.$inferSelect;
export type InsertAgentLearningSample = typeof agentLearningSamples.$inferInsert;
export type AgentKnowledgeBase = typeof agentKnowledgeBase.$inferSelect;
export type InsertAgentKnowledgeBase = typeof agentKnowledgeBase.$inferInsert;
export type AgentGeneratedContent = typeof agentGeneratedContent.$inferSelect;
export type InsertAgentGeneratedContent = typeof agentGeneratedContent.$inferInsert;
