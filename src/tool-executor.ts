import { v4 as uuidv4 } from "uuid";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { ProjectDbPool } from "./project-db-wrapper";
import { agentActions, type InsertAgentAction } from "./schema";
import type { Tool } from "./llm";

/**
 * Tool Executor
 * 
 * Executes agent actions (database queries, content generation, file operations)
 * Implements tool calling interface for LLM
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
}

export interface ToolExecutionContext {
  userId: number;
  projectId?: number;
  conversationId?: string;
  db: MySql2Database<any>;
  mainDb: MySql2Database<any>; // Alias for db, used by narrative tools
  projectDb?: ProjectDbPool;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTimeMs: number;
}

export class ToolExecutor {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(private db: MySql2Database<any>) {}

  /**
   * Register a tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: ToolDefinition[]): void {
    tools.forEach((tool) => this.registerTool(tool));
  }

  /**
   * Get all registered tools as LLM tool definitions
   */
  getToolDefinitions(): Tool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Execute a tool by name
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const actionId = uuidv4();

    try {
      const tool = this.tools.get(toolName);
      if (!tool) {
        throw new Error(`Tool "${toolName}" not found`);
      }

      // Validate required parameters
      const missing = tool.parameters.required.filter(
        (param) => !(param in args)
      );
      if (missing.length > 0) {
        throw new Error(
          `Missing required parameters: ${missing.join(", ")}`
        );
      }

      // Execute the tool
      const result = await tool.handler(args, context);
      const executionTimeMs = Date.now() - startTime;

      // Log the action
      // IMPORTANT: Use ?? null (not || null) to avoid converting projectId=0 to null
      // Use null instead of undefined for optional fields — mysql2 converts undefined to ''
      await this.logAction({
        id: actionId,
        conversationId: context.conversationId ?? null,
        userId: context.userId,
        projectId: context.projectId ?? null,
        actionType: this.getActionType(toolName),
        actionName: toolName,
        input: args,
        output: result as Record<string, unknown>,
        success: 1,
        errorMessage: null,
        executionTimeMs,
      });

      return {
        success: true,
        result,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Log the failed action
      // IMPORTANT: Use ?? null (not || null) and null instead of undefined
      await this.logAction({
        id: actionId,
        conversationId: context.conversationId ?? null,
        userId: context.userId,
        projectId: context.projectId ?? null,
        actionType: this.getActionType(toolName),
        actionName: toolName,
        input: args,
        output: null,
        success: 0,
        errorMessage,
        executionTimeMs,
      });

      return {
        success: false,
        error: errorMessage,
        executionTimeMs,
      };
    }
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeTools(
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const call of toolCalls) {
      const result = await this.executeTool(call.name, call.arguments, context);
      results.push(result);

      // Stop execution if a tool fails
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Log an action to the database
   */
  private async logAction(action: InsertAgentAction): Promise<void> {
    try {
      await this.db.insert(agentActions).values(action);
    } catch (error) {
      console.error("Failed to log agent action:", error);
      // Don't throw - logging failure shouldn't break tool execution
    }
  }

  /**
   * Determine action type from tool name
   */
  private getActionType(toolName: string): string {
    if (toolName.includes("query") || toolName.includes("search") || toolName.includes("get")) {
      return "query";
    }
    if (toolName.includes("generate") || toolName.includes("create")) {
      return "generate";
    }
    if (toolName.includes("update") || toolName.includes("modify") || toolName.includes("edit")) {
      return "modify";
    }
    if (toolName.includes("analyze") || toolName.includes("validate")) {
      return "analyze";
    }
    return "other";
  }

  /**
   * Validate tool arguments against schema
   */
  validateArguments(
    toolName: string,
    args: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { valid: false, errors: [`Tool "${toolName}" not found`] };
    }

    const errors: string[] = [];

    // Check required parameters
    const missing = tool.parameters.required.filter((param) => !(param in args));
    if (missing.length > 0) {
      errors.push(`Missing required parameters: ${missing.join(", ")}`);
    }

    // Check parameter types
    for (const [key, value] of Object.entries(args)) {
      const paramDef = tool.parameters.properties[key];
      if (!paramDef) {
        errors.push(`Unknown parameter: ${key}`);
        continue;
      }

      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (paramDef.type !== actualType) {
        errors.push(
          `Parameter "${key}" should be ${paramDef.type}, got ${actualType}`
        );
      }

      // Check enum values
      if (paramDef.enum && !paramDef.enum.includes(String(value))) {
        errors.push(
          `Parameter "${key}" must be one of: ${paramDef.enum.join(", ")}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
