/**
 * @oe-ecosystem/ai-agent
 * 
 * AI Agent module for the OE Ecosystem
 * Provides conversational AI capabilities with tool execution, learning, and content generation
 */

// Core Components
export { AgentOrchestrator } from './agent-orchestrator';
export type { AgentRequest, AgentResponse } from './agent-orchestrator';

export { ConversationManager } from './conversation-manager';
export type { 
  ConversationContext, 
  CreateConversationParams, 
  AddMessageParams 
} from './conversation-manager';

export { ToolExecutor } from './tool-executor';
export type { 
  ToolDefinition, 
  ToolExecutionContext, 
  ToolExecutionResult 
} from './tool-executor';

export { LearningEngine } from './learning-engine';
export type { 
  EditAnalysis, 
  StylePatterns 
} from './learning-engine';

// Database Schema
export {
  agentConversations,
  agentMessages,
  agentActions,
  agentLearningSamples,
  agentStyleModels,
  agentKnowledgeBase,
  agentGeneratedContent,
} from './schema';

export type {
  AgentConversation,
  AgentMessage,
  AgentAction,
  AgentLearningSample,
  AgentStyleModel,
  AgentKnowledgeBase,
  AgentGeneratedContent,
  InsertAgentConversation,
  InsertAgentMessage,
  InsertAgentAction,
  InsertAgentLearningSample,
  InsertAgentStyleModel,
  InsertAgentKnowledgeBase,
  InsertAgentGeneratedContent,
} from './schema';

// Tools
export { queryTools } from './tools/query-tools';
export { generationTools } from './tools/generation-tools';
export { workflowTools } from './tools/workflow-tools';

// tRPC Router Factory (optional - for direct integration)
export { createAgentRouter } from './create-agent-router';
export type { AgentRouterDependencies } from './create-agent-router';

// LLM and Database Types
export type { Message, Tool, ToolCall, Role } from './llm';
export { invokeLLM } from './llm';
export type { ProjectDbPool, ProjectDbConnection } from './project-db-wrapper';
export { wrapPool, wrapConnection } from './project-db-wrapper';
