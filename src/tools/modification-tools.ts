import type { ToolDefinition } from "../tool-executor";
import { agentGeneratedContent } from "../schema";
import { eq, and } from "drizzle-orm";

/**
 * Modification Tools
 * 
 * Tools for creating, updating, and deleting project data (facts, documents, narratives)
 */

// ============================================================================
// FACT MODIFICATION TOOLS
// ============================================================================

export const createFactTool: ToolDefinition = {
  name: "create_fact",
  description: "Create a new fact in the project database. Use this to add new information discovered during conversation or to record user-provided data.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Fact category (e.g., Project_Overview, Design_Parameters, Technical_Design, Financial, Location, Dependencies, Risks_And_Issues, Performance)",
      },
      key: {
        type: "string",
        description: "Fact key/name (e.g., DC_Capacity, AC_Capacity, Project_Name, Location, Technology_Type)",
      },
      value: {
        type: "string",
        description: "Fact value/content",
      },
      dataType: {
        type: "string",
        description: "Data type of the value",
        enum: ["string", "number", "date", "boolean", "json"],
      },
      confidence: {
        type: "number",
        description: "Confidence score (0.0 to 1.0). Use 1.0 for user-provided data, lower for inferred data.",
      },
      sourceDocumentId: {
        type: "number",
        description: "Optional: ID of source document if fact was extracted from a document",
      },
      extractionMethod: {
        type: "string",
        description: "How this fact was obtained (e.g., 'user_provided', 'agent_inferred', 'document_extraction')",
      },
      verified: {
        type: "boolean",
        description: "Whether this fact has been verified by a user (default: false)",
      },
    },
    required: ["category", "key", "value", "dataType", "confidence"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    const verified = args.verified ? 1 : 0;
    const extractionMethod = args.extractionMethod || 'agent_created';
    
    const query = `
      INSERT INTO ${tableName} 
        (category, \`key\`, value, data_type, confidence, source_document_id, extraction_method, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const values = [
      args.category,
      args.key,
      args.value,
      args.dataType,
      args.confidence,
      args.sourceDocumentId || null,
      extractionMethod,
      verified,
    ];

    console.log("[CREATE_FACT DEBUG] Executing query:", query);
    console.log("[CREATE_FACT DEBUG] Values:", values);

    const result = await context.projectDb.execute(query, values);
    const insertId = (result[0] as any).insertId;

    console.log("[CREATE_FACT DEBUG] Created fact with ID:", insertId);

    return {
      success: true,
      factId: insertId,
      message: `Created fact: ${args.category}.${args.key} = ${args.value}`,
    };
  },
};

export const updateFactTool: ToolDefinition = {
  name: "update_fact",
  description: "Update an existing fact in the project database. Can update value, confidence, verification status, or other fields.",
  parameters: {
    type: "object",
    properties: {
      factId: {
        type: "number",
        description: "ID of the fact to update",
      },
      value: {
        type: "string",
        description: "New value for the fact",
      },
      confidence: {
        type: "number",
        description: "New confidence score (0.0 to 1.0)",
      },
      verified: {
        type: "boolean",
        description: "Whether this fact has been verified",
      },
      category: {
        type: "string",
        description: "Update the category",
      },
      key: {
        type: "string",
        description: "Update the key/name",
      },
      dataType: {
        type: "string",
        description: "Update the data type",
        enum: ["string", "number", "date", "boolean", "json"],
      },
    },
    required: ["factId"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    const updates: string[] = [];
    const values: any[] = [];

    // Build SET clause dynamically based on provided fields
    if (args.value !== undefined) {
      updates.push("value = ?");
      values.push(args.value);
    }
    if (args.confidence !== undefined) {
      updates.push("confidence = ?");
      values.push(args.confidence);
    }
    if (args.verified !== undefined) {
      updates.push("verified = ?");
      values.push(args.verified ? 1 : 0);
    }
    if (args.category !== undefined) {
      updates.push("category = ?");
      values.push(args.category);
    }
    if (args.key !== undefined) {
      updates.push("`key` = ?");
      values.push(args.key);
    }
    if (args.dataType !== undefined) {
      updates.push("data_type = ?");
      values.push(args.dataType);
    }

    if (updates.length === 0) {
      throw new Error("No fields to update. Provide at least one field to update.");
    }

    values.push(args.factId);

    const query = `
      UPDATE ${tableName}
      SET ${updates.join(", ")}
      WHERE id = ?
    `;

    console.log("[UPDATE_FACT DEBUG] Executing query:", query);
    console.log("[UPDATE_FACT DEBUG] Values:", values);

    const result = await context.projectDb.execute(query, values);
    const affectedRows = (result[0] as any).affectedRows;

    console.log("[UPDATE_FACT DEBUG] Affected rows:", affectedRows);

    if (affectedRows === 0) {
      return {
        success: false,
        message: `Fact with ID ${args.factId} not found`,
      };
    }

    return {
      success: true,
      factId: args.factId,
      message: `Updated fact ID ${args.factId}`,
      updatedFields: Object.keys(args).filter(k => k !== 'factId'),
    };
  },
};

export const deleteFactTool: ToolDefinition = {
  name: "delete_fact",
  description: "Delete a fact from the project database. Use with caution - this operation cannot be undone.",
  parameters: {
    type: "object",
    properties: {
      factId: {
        type: "number",
        description: "ID of the fact to delete",
      },
      confirm: {
        type: "boolean",
        description: "Must be set to true to confirm deletion",
      },
    },
    required: ["factId", "confirm"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    if (!args.confirm) {
      throw new Error("Deletion not confirmed. Set confirm=true to proceed.");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    
    // First, get the fact details before deleting
    const selectQuery = `SELECT category, \`key\`, value FROM ${tableName} WHERE id = ?`;
    const selectResult = await context.projectDb.execute(selectQuery, [args.factId]);
    const fact = (selectResult[0] as any[])[0];

    if (!fact) {
      return {
        success: false,
        message: `Fact with ID ${args.factId} not found`,
      };
    }

    // Now delete it
    const deleteQuery = `DELETE FROM ${tableName} WHERE id = ?`;
    console.log("[DELETE_FACT DEBUG] Executing query:", deleteQuery);
    console.log("[DELETE_FACT DEBUG] Fact ID:", args.factId);

    const result = await context.projectDb.execute(deleteQuery, [args.factId]);
    const affectedRows = (result[0] as any).affectedRows;

    console.log("[DELETE_FACT DEBUG] Affected rows:", affectedRows);

    return {
      success: true,
      factId: args.factId,
      message: `Deleted fact: ${fact.category}.${fact.key} = ${fact.value}`,
      deletedFact: fact,
    };
  },
};

export const verifyFactTool: ToolDefinition = {
  name: "verify_fact",
  description: "Mark a fact as verified or unverified. This is a shortcut for updating the verified field.",
  parameters: {
    type: "object",
    properties: {
      factId: {
        type: "number",
        description: "ID of the fact to verify/unverify",
      },
      verified: {
        type: "boolean",
        description: "True to mark as verified, false to mark as unverified",
      },
    },
    required: ["factId", "verified"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    const verifiedValue = args.verified ? 1 : 0;
    
    const query = `
      UPDATE ${tableName}
      SET verified = ?
      WHERE id = ?
    `;

    console.log("[VERIFY_FACT DEBUG] Executing query:", query);
    console.log("[VERIFY_FACT DEBUG] Fact ID:", args.factId, "Verified:", args.verified);

    const result = await context.projectDb.execute(query, [verifiedValue, args.factId]);
    const affectedRows = (result[0] as any).affectedRows;

    if (affectedRows === 0) {
      return {
        success: false,
        message: `Fact with ID ${args.factId} not found`,
      };
    }

    return {
      success: true,
      factId: args.factId,
      verified: args.verified,
      message: `Fact ID ${args.factId} marked as ${args.verified ? 'verified' : 'unverified'}`,
    };
  },
};

// Export all fact tools as an array
export const factModificationTools = [
  createFactTool,
  updateFactTool,
  deleteFactTool,
  verifyFactTool,
];

// ============================================================================
// RED FLAG MODIFICATION TOOLS
// ============================================================================
// Note: Red flags are stored as facts with category='Risks_And_Issues'

export const createRedFlagTool: ToolDefinition = {
  name: "create_red_flag",
  description: "Create a new red flag (risk or issue) in the project. Red flags are stored as facts with category='Risks_And_Issues'.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title/name of the risk or issue",
      },
      description: {
        type: "string",
        description: "Detailed description of the risk or issue",
      },
      severity: {
        type: "string",
        description: "Severity level",
        enum: ["critical", "high", "medium", "low"],
      },
      confidence: {
        type: "number",
        description: "Confidence score (0.0 to 1.0). Use 1.0 for user-reported issues, lower for agent-detected risks.",
      },
      sourceDocumentId: {
        type: "number",
        description: "Optional: ID of source document if red flag was identified from a document",
      },
    },
    required: ["title", "description", "severity", "confidence"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    
    // Store red flag as a fact with category='Risks_And_Issues'
    // Key = title, Value = JSON with description and severity
    const value = JSON.stringify({
      description: args.description,
      severity: args.severity,
    });
    
    const query = `
      INSERT INTO ${tableName} 
        (category, \`key\`, value, data_type, confidence, source_document_id, extraction_method, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const values = [
      'Risks_And_Issues',
      args.title,
      value,
      'json',
      args.confidence,
      args.sourceDocumentId || null,
      'agent_created',
      0, // Not verified by default
    ];

    console.log("[CREATE_RED_FLAG DEBUG] Executing query:", query);
    console.log("[CREATE_RED_FLAG DEBUG] Values:", values);

    const result = await context.projectDb.execute(query, values);
    const insertId = (result[0] as any).insertId;

    console.log("[CREATE_RED_FLAG DEBUG] Created red flag with ID:", insertId);

    return {
      success: true,
      redFlagId: insertId,
      message: `Created red flag: ${args.title} (${args.severity})`,
    };
  },
};

export const updateRedFlagTool: ToolDefinition = {
  name: "update_red_flag",
  description: "Update an existing red flag. Can update title, description, severity, or verification status.",
  parameters: {
    type: "object",
    properties: {
      redFlagId: {
        type: "number",
        description: "ID of the red flag to update",
      },
      title: {
        type: "string",
        description: "New title for the red flag",
      },
      description: {
        type: "string",
        description: "New description",
      },
      severity: {
        type: "string",
        description: "New severity level",
        enum: ["critical", "high", "medium", "low"],
      },
      verified: {
        type: "boolean",
        description: "Whether this red flag has been verified",
      },
      confidence: {
        type: "number",
        description: "New confidence score (0.0 to 1.0)",
      },
    },
    required: ["redFlagId"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    
    // First, get the current red flag data
    const selectQuery = `SELECT \`key\`, value FROM ${tableName} WHERE id = ? AND category = 'Risks_And_Issues'`;
    const selectResult = await context.projectDb.execute(selectQuery, [args.redFlagId]);
    const redFlag = (selectResult[0] as any[])[0];

    if (!redFlag) {
      return {
        success: false,
        message: `Red flag with ID ${args.redFlagId} not found`,
      };
    }

    // Parse current value
    let currentData: any = {};
    try {
      currentData = JSON.parse(redFlag.value);
    } catch (e) {
      // If value is not JSON, treat it as description
      currentData = { description: redFlag.value };
    }

    // Build updates
    const updates: string[] = [];
    const values: any[] = [];

    if (args.title !== undefined) {
      updates.push("`key` = ?");
      values.push(args.title);
    }

    if (args.description !== undefined || args.severity !== undefined) {
      // Update the JSON value
      const newData = {
        description: args.description !== undefined ? args.description : currentData.description,
        severity: args.severity !== undefined ? args.severity : currentData.severity,
      };
      updates.push("value = ?");
      values.push(JSON.stringify(newData));
    }

    if (args.confidence !== undefined) {
      updates.push("confidence = ?");
      values.push(args.confidence);
    }

    if (args.verified !== undefined) {
      updates.push("verified = ?");
      values.push(args.verified ? 1 : 0);
    }

    if (updates.length === 0) {
      throw new Error("No fields to update. Provide at least one field to update.");
    }

    values.push(args.redFlagId);

    const query = `
      UPDATE ${tableName}
      SET ${updates.join(", ")}
      WHERE id = ? AND category = 'Risks_And_Issues'
    `;

    console.log("[UPDATE_RED_FLAG DEBUG] Executing query:", query);
    console.log("[UPDATE_RED_FLAG DEBUG] Values:", values);

    const result = await context.projectDb.execute(query, values);
    const affectedRows = (result[0] as any).affectedRows;

    console.log("[UPDATE_RED_FLAG DEBUG] Affected rows:", affectedRows);

    return {
      success: true,
      redFlagId: args.redFlagId,
      message: `Updated red flag ID ${args.redFlagId}`,
      updatedFields: Object.keys(args).filter(k => k !== 'redFlagId'),
    };
  },
};

export const deleteRedFlagTool: ToolDefinition = {
  name: "delete_red_flag",
  description: "Delete a red flag from the project. Use with caution - this operation cannot be undone.",
  parameters: {
    type: "object",
    properties: {
      redFlagId: {
        type: "number",
        description: "ID of the red flag to delete",
      },
      confirm: {
        type: "boolean",
        description: "Must be set to true to confirm deletion",
      },
    },
    required: ["redFlagId", "confirm"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    if (!args.confirm) {
      throw new Error("Deletion not confirmed. Set confirm=true to proceed.");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    
    // First, get the red flag details before deleting
    const selectQuery = `SELECT \`key\`, value FROM ${tableName} WHERE id = ? AND category = 'Risks_And_Issues'`;
    const selectResult = await context.projectDb.execute(selectQuery, [args.redFlagId]);
    const redFlag = (selectResult[0] as any[])[0];

    if (!redFlag) {
      return {
        success: false,
        message: `Red flag with ID ${args.redFlagId} not found`,
      };
    }

    // Now delete it
    const deleteQuery = `DELETE FROM ${tableName} WHERE id = ? AND category = 'Risks_And_Issues'`;
    console.log("[DELETE_RED_FLAG DEBUG] Executing query:", deleteQuery);
    console.log("[DELETE_RED_FLAG DEBUG] Red flag ID:", args.redFlagId);

    const result = await context.projectDb.execute(deleteQuery, [args.redFlagId]);
    const affectedRows = (result[0] as any).affectedRows;

    console.log("[DELETE_RED_FLAG DEBUG] Affected rows:", affectedRows);

    return {
      success: true,
      redFlagId: args.redFlagId,
      message: `Deleted red flag: ${redFlag.key}`,
      deletedRedFlag: redFlag,
    };
  },
};

export const resolveRedFlagTool: ToolDefinition = {
  name: "resolve_red_flag",
  description: "Mark a red flag as resolved by adding resolution information. This updates the red flag's value to include resolution details.",
  parameters: {
    type: "object",
    properties: {
      redFlagId: {
        type: "number",
        description: "ID of the red flag to resolve",
      },
      resolution: {
        type: "string",
        description: "Description of how the red flag was resolved",
      },
      resolvedBy: {
        type: "string",
        description: "Who resolved this red flag (user name or 'agent')",
      },
    },
    required: ["redFlagId", "resolution"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    
    // First, get the current red flag data
    const selectQuery = `SELECT \`key\`, value FROM ${tableName} WHERE id = ? AND category = 'Risks_And_Issues'`;
    const selectResult = await context.projectDb.execute(selectQuery, [args.redFlagId]);
    const redFlag = (selectResult[0] as any[])[0];

    if (!redFlag) {
      return {
        success: false,
        message: `Red flag with ID ${args.redFlagId} not found`,
      };
    }

    // Parse current value and add resolution
    let currentData: any = {};
    try {
      currentData = JSON.parse(redFlag.value);
    } catch (e) {
      currentData = { description: redFlag.value };
    }

    const updatedData = {
      ...currentData,
      resolved: true,
      resolution: args.resolution,
      resolvedBy: args.resolvedBy || 'agent',
      resolvedAt: new Date().toISOString(),
    };

    const query = `
      UPDATE ${tableName}
      SET value = ?, verified = 1
      WHERE id = ? AND category = 'Risks_And_Issues'
    `;

    console.log("[RESOLVE_RED_FLAG DEBUG] Executing query:", query);
    console.log("[RESOLVE_RED_FLAG DEBUG] Red flag ID:", args.redFlagId);

    const result = await context.projectDb.execute(query, [JSON.stringify(updatedData), args.redFlagId]);
    const affectedRows = (result[0] as any).affectedRows;

    console.log("[RESOLVE_RED_FLAG DEBUG] Affected rows:", affectedRows);

    return {
      success: true,
      redFlagId: args.redFlagId,
      message: `Resolved red flag: ${redFlag.key}`,
      resolution: args.resolution,
    };
  },
};

// Export all red flag tools as an array
export const redFlagModificationTools = [
  createRedFlagTool,
  updateRedFlagTool,
  deleteRedFlagTool,
  resolveRedFlagTool,
];

// ============================================================================
// NARRATIVE & OVERVIEW MANAGEMENT TOOLS
// ============================================================================
// These tools manage project narratives, overviews, and generated content
// Stored in agentGeneratedContent table

export const createNarrativeTool: ToolDefinition = {
  name: "create_narrative",
  description: "Create a new narrative or overview for the project. Use this to generate project summaries, risk narratives, technical descriptions, or any other written content.",
  parameters: {
    type: "object",
    properties: {
      contentType: {
        type: "string",
        description: "Type of narrative content (e.g., 'project_overview', 'risk_narrative', 'technical_summary', 'executive_summary', 'report')",
      },
      title: {
        type: "string",
        description: "Title of the narrative",
      },
      content: {
        type: "string",
        description: "The narrative content (can be markdown or plain text)",
      },
      metadata: {
        type: "object",
        description: "Optional metadata (e.g., { section: 'risks', version: 1, tags: ['solar', 'design'] })",
      },
    },
    required: ["contentType", "title", "content"],
  },
  handler: async (args, context) => {
    if (!context.mainDb) {
      throw new Error("Main database not available");
    }

    // Generate UUID for the narrative
    const { randomUUID } = await import('crypto');
    const id = randomUUID();
    
    const metadata = args.metadata || {};
    // Add title to metadata
    const enrichedMetadata = {
      ...metadata,
      title: args.title,
    };

    console.log("[CREATE_NARRATIVE DEBUG] Creating narrative with ID:", id);

    await context.mainDb.insert(agentGeneratedContent).values({
      id,
      userId: context.userId,
      projectId: context.projectId || 0,
      conversationId: context.conversationId || undefined,
      contentType: args.contentType as string,
      content: args.content as string,
      prompt: undefined,
      modelVersion: 'user_created',
      userEdited: 0,
      finalVersion: undefined,
      metadata: enrichedMetadata,
      createdAt: undefined,
      updatedAt: undefined,
    });

    console.log("[CREATE_NARRATIVE DEBUG] Created narrative with ID:", id);

    return {
      success: true,
      narrativeId: id,
      message: `Created narrative: ${args.title} (${args.contentType})`,
    };
  },
};

export const updateNarrativeTool: ToolDefinition = {
  name: "update_narrative",
  description: "Update an existing narrative or overview. Can update content, mark as user-edited, or update metadata.",
  parameters: {
    type: "object",
    properties: {
      narrativeId: {
        type: "string",
        description: "UUID of the narrative to update",
      },
      content: {
        type: "string",
        description: "New content for the narrative",
      },
      title: {
        type: "string",
        description: "New title for the narrative",
      },
      userEdited: {
        type: "boolean",
        description: "Mark whether this was edited by a user",
      },
      metadata: {
        type: "object",
        description: "Updated metadata",
      },
    },
    required: ["narrativeId"],
  },
  handler: async (args, context) => {
    if (!context.mainDb) {
      throw new Error("Main database not available");
    }

    const updateData: any = {};
    let hasUpdates = false;

    if (args.content !== undefined) {
      updateData.content = args.content as string;
      updateData.finalVersion = args.content as string;
      hasUpdates = true;
    }

    if (args.userEdited !== undefined) {
      updateData.userEdited = args.userEdited ? 1 : 0;
      hasUpdates = true;
    }

    if (args.metadata !== undefined || args.title !== undefined) {
      // Get current metadata first
      const [existing] = await context.mainDb
        .select()
        .from(agentGeneratedContent)
        .where(eq(agentGeneratedContent.id, args.narrativeId as string));
      
      if (!existing) {
        return {
          success: false,
          message: `Narrative with ID ${args.narrativeId} not found`,
        };
      }

      let currentMetadata: any = {};
      try {
        currentMetadata = typeof existing.metadata === 'string' 
          ? JSON.parse(existing.metadata) 
          : existing.metadata || {};
      } catch (e) {
        currentMetadata = {};
      }

      const newMetadata = {
        ...currentMetadata,
        ...(args.metadata || {}),
        ...(args.title ? { title: args.title } : {}),
      };

      updateData.metadata = newMetadata;
      hasUpdates = true;
    }

    if (!hasUpdates) {
      throw new Error("No fields to update. Provide at least one field to update.");
    }

    // Always update updatedAt
    updateData.updatedAt = undefined; // Let DB handle timestamp

    console.log("[UPDATE_NARRATIVE DEBUG] Updating narrative:", args.narrativeId);
    console.log("[UPDATE_NARRATIVE DEBUG] Update data:", updateData);

    await context.mainDb
      .update(agentGeneratedContent)
      .set(updateData)
      .where(eq(agentGeneratedContent.id, args.narrativeId as string));

    console.log("[UPDATE_NARRATIVE DEBUG] Updated narrative:", args.narrativeId);

    return {
      success: true,
      narrativeId: args.narrativeId,
      message: `Updated narrative ID ${args.narrativeId}`,
      updatedFields: Object.keys(args).filter(k => k !== 'narrativeId'),
    };
  },
};

export const deleteNarrativeTool: ToolDefinition = {
  name: "delete_narrative",
  description: "Delete a narrative or overview from the project. Use with caution - this operation cannot be undone.",
  parameters: {
    type: "object",
    properties: {
      narrativeId: {
        type: "string",
        description: "UUID of the narrative to delete",
      },
      confirm: {
        type: "boolean",
        description: "Must be set to true to confirm deletion",
      },
    },
    required: ["narrativeId", "confirm"],
  },
  handler: async (args, context) => {
    if (!context.mainDb) {
      throw new Error("Main database not available");
    }

    if (!args.confirm) {
      throw new Error("Deletion not confirmed. Set confirm=true to proceed.");
    }

    // First, get the narrative details before deleting
    const [narrative] = await context.mainDb
      .select()
      .from(agentGeneratedContent)
      .where(eq(agentGeneratedContent.id, args.narrativeId as string));

    if (!narrative) {
      return {
        success: false,
        message: `Narrative with ID ${args.narrativeId} not found`,
      };
    }

    // Now delete it
    console.log("[DELETE_NARRATIVE DEBUG] Deleting narrative:", args.narrativeId);

    await context.mainDb
      .delete(agentGeneratedContent)
      .where(eq(agentGeneratedContent.id, args.narrativeId as string));

    console.log("[DELETE_NARRATIVE DEBUG] Deleted narrative:", args.narrativeId);

    let title = 'Unknown';
    try {
      const metadata = typeof narrative.metadata === 'string'
        ? JSON.parse(narrative.metadata)
        : narrative.metadata || {};
      title = metadata.title || title;
    } catch (e) {
      // Ignore
    }

    return {
      success: true,
      narrativeId: args.narrativeId,
      message: `Deleted narrative: ${title} (${narrative.contentType})`,
      deletedNarrative: {
        contentType: narrative.contentType,
        title,
      },
    };
  },
};

export const listNarrativesTool: ToolDefinition = {
  name: "list_narratives",
  description: "List all narratives and overviews for the project. Can filter by content type.",
  parameters: {
    type: "object",
    properties: {
      contentType: {
        type: "string",
        description: "Filter by content type (e.g., 'project_overview', 'risk_narrative', 'technical_summary')",
      },
      limit: {
        type: "number",
        description: "Maximum number of narratives to return (default: 50)",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.mainDb) {
      throw new Error("Main database not available");
    }

    const limit = (args.limit as number) || 50;

    console.log("[LIST_NARRATIVES DEBUG] Listing narratives for project:", context.projectId);

    let whereClause = eq(agentGeneratedContent.projectId, context.projectId || 0);
    if (args.contentType) {
      whereClause = and(
        eq(agentGeneratedContent.projectId, context.projectId || 0),
        eq(agentGeneratedContent.contentType, args.contentType as string)
      )!;
    }

    const rows = await context.mainDb
      .select()
      .from(agentGeneratedContent)
      .where(whereClause)
      .orderBy(agentGeneratedContent.updatedAt)
      .limit(limit);

    // Parse metadata to extract titles
    const narratives = rows.map(row => {
      let title = 'Untitled';
      try {
        const metadata = typeof row.metadata === 'string'
          ? JSON.parse(row.metadata)
          : row.metadata || {};
        title = metadata.title || title;
      } catch (e) {
        // Ignore
      }

      return {
        id: row.id,
        title,
        contentType: row.contentType,
        userEdited: row.userEdited === 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        contentPreview: row.content ? row.content.substring(0, 200) : '',
      };
    });

    console.log("[LIST_NARRATIVES DEBUG] Found narratives:", narratives.length);

    return {
      narratives,
      count: narratives.length,
      filters: {
        contentType: args.contentType,
      },
    };
  },
};

export const getNarrativeTool: ToolDefinition = {
  name: "get_narrative",
  description: "Get the full content of a specific narrative by ID.",
  parameters: {
    type: "object",
    properties: {
      narrativeId: {
        type: "string",
        description: "UUID of the narrative to retrieve",
      },
    },
    required: ["narrativeId"],
  },
  handler: async (args, context) => {
    if (!context.mainDb) {
      throw new Error("Main database not available");
    }

    console.log("[GET_NARRATIVE DEBUG] Getting narrative:", args.narrativeId);

    const [row] = await context.mainDb
      .select()
      .from(agentGeneratedContent)
      .where(and(
        eq(agentGeneratedContent.id, args.narrativeId as string),
        eq(agentGeneratedContent.projectId, context.projectId || 0)
      )!);

    if (!row) {
      return {
        success: false,
        message: `Narrative with ID ${args.narrativeId} not found`,
      };
    }

    let title = 'Untitled';
    let metadata: any = {};
    try {
      metadata = typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata || {};
      title = metadata.title || title;
    } catch (e) {
      // Ignore
    }

    return {
      success: true,
      narrative: {
        id: row.id,
        title,
        contentType: row.contentType,
        content: row.content,
        finalVersion: row.finalVersion,
        userEdited: row.userEdited === 1,
        metadata,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  },
};

// Export all narrative tools as an array
export const narrativeModificationTools = [
  createNarrativeTool,
  updateNarrativeTool,
  deleteNarrativeTool,
  listNarrativesTool,
  getNarrativeTool,
];

// Export all modification tools together
export const allModificationTools = [
  ...factModificationTools,
  ...redFlagModificationTools,
  ...narrativeModificationTools,
];
