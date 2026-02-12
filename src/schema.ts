import { mysqlTable, varchar, text, timestamp, int, json, boolean, tinyint } from "drizzle-orm/mysql-core";

/**
 * Agent Module Database Schema
 * 
 * Tables for managing AI agent conversations, learning, and style adaptation
 * ALL TABLES AND COLUMNS USE camelCase NAMING
 */

/**
 * Conversations table - stores multi-turn conversation history
 */
export const agentConversations = mysqlTable("agentConversations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  title: varchar("title", { length: 255 }),
  context: json("context").$type<{
    currentPage?: string;
    workflowStage?: string;
    relevantDocuments?: string[];
    relevantFacts?: string[];
  }>(),
  status: varchar("status", { length: 20 }).default("active"), // active, archived
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Messages table - individual messages within conversations
 */
export const agentMessages = mysqlTable("agentMessages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversationId", { length: 36 }).notNull(),
  role: varchar("role", { length: 20 }).notNull(), // user, assistant, system, tool
  content: text("content"),
  toolCalls: json("toolCalls").$type<Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>>(),
  toolCallId: varchar("toolCallId", { length: 255 }),
  metadata: json("metadata").$type<{
    tokens?: number;
    model?: string;
    latency?: number;
    error?: string;
  }>(),
  createdAt: timestamp("createdAt").defaultNow(),
});

/**
 * Agent actions log - audit trail of all agent operations
 */
export const agentActions = mysqlTable("agentActions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversationId", { length: 36 }),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  actionType: varchar("actionType", { length: 50 }).notNull(), // query, generate, modify, analyze
  actionName: varchar("actionName", { length: 100 }).notNull(),
  input: json("input").$type<Record<string, unknown>>(),
  output: json("output").$type<Record<string, unknown>>(),
  success: tinyint("success").notNull(),
  errorMessage: text("errorMessage"),
  executionTimeMs: int("executionTimeMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Style models - user-specific writing style patterns
 */
export const agentStyleModels = mysqlTable("agentStyleModels", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Learning samples - draft vs final comparisons for training
 */
export const agentLearningSamples = mysqlTable("agentLearningSamples", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  contentType: varchar("contentType", { length: 50 }).notNull(), // risk_narrative, report, specification
  draftContent: text("draftContent").notNull(),
  finalContent: text("finalContent").notNull(),
  extractedPatterns: json("extractedPatterns").$type<{
    addedPhrases?: string[];
    removedPhrases?: string[];
    styleChanges?: string[];
    structuralChanges?: string[];
  }>(),
  editDistance: int("editDistance"),
  applied: tinyint("applied").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Shared knowledge base - de-identified cross-project insights
 */
export const agentKnowledgeBase = mysqlTable("agentKnowledgeBase", {
  id: varchar("id", { length: 36 }).primaryKey(),
  category: varchar("category", { length: 100 }).notNull(), // domain_knowledge, best_practice, pattern
  topic: varchar("topic", { length: 255 }).notNull(),
  content: text("content").notNull(),
  confidence: varchar("confidence", { length: 20 }).default("medium"), // low, medium, high
  sourceCount: int("sourceCount").default(1), // Number of projects this was derived from
  metadata: json("metadata").$type<{
    tags?: string[];
    relatedTopics?: string[];
    applicability?: string[];
  }>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Generated content tracking - for learning and improvement
 */
export const agentGeneratedContent = mysqlTable("agentGeneratedContent", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  conversationId: varchar("conversationId", { length: 36 }),
  contentType: varchar("contentType", { length: 50 }).notNull(),
  content: text("content").notNull(),
  prompt: text("prompt"),
  modelVersion: varchar("modelVersion", { length: 50 }),
  userEdited: tinyint("userEdited").default(0),
  finalVersion: text("finalVersion"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
