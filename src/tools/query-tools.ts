import { eq, like, and, desc, sql } from "drizzle-orm";
import type { ToolDefinition } from "../tool-executor";

/**
 * Query Tools
 * 
 * Tools for querying project data (documents, facts, red flags)
 */

export const queryFactsTool: ToolDefinition = {
  name: "query_facts",
  description: "Query extracted facts from the project database. Can filter by category, key, or search in values.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Filter by fact category (e.g., 'technical', 'financial', 'location')",
      },
      key: {
        type: "string",
        description: "Filter by fact key (e.g., 'capacity_mw', 'location_coordinates')",
      },
      searchTerm: {
        type: "string",
        description: "Search term to find in fact values",
      },
      limit: {
        type: "number",
        description: "Maximum number of facts to return (default: 50)",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const limit = (args.limit as number) || 50;
    const conditions = [];

    // Build query conditions
    if (args.category) {
      conditions.push(sql`category = ${args.category}`);
    }
    if (args.key) {
      conditions.push(sql`\`key\` = ${args.key}`);
    }
    if (args.searchTerm) {
      conditions.push(sql`value LIKE ${`%${args.searchTerm}%`}`);
    }

    // Build and execute query
    // Use project-specific table name (e.g., proj_390002_extracted_facts)
    const tableName = `proj_${context.projectId}_extracted_facts`;
    let query = `
      SELECT id, category, \`key\`, value, data_type, confidence, 
             source_document_id, extraction_method, verified, created_at
      FROM ${tableName}
    `;

    if (conditions.length > 0) {
      query += ` AND ${conditions.map((_, i) => `?`).join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const result = await context.projectDb.execute(query);
    const rows = result[0] as any[];
    
    return {
      facts: rows,
      count: rows.length,
      filters: {
        category: args.category,
        key: args.key,
        searchTerm: args.searchTerm,
      },
    };
  },
};

export const queryDocumentsTool: ToolDefinition = {
  name: "query_documents",
  description: "Query documents in the project. Can filter by document type or search in file names.",
  parameters: {
    type: "object",
    properties: {
      documentType: {
        type: "string",
        description: "Filter by document type",
        enum: ["IM", "DD_PACK", "CONTRACT", "GRID_STUDY", "CONCEPT_DESIGN", "WEATHER_FILE", "OTHER"],
      },
      searchTerm: {
        type: "string",
        description: "Search term to find in file names",
      },
      status: {
        type: "string",
        description: "Filter by processing status",
        enum: ["uploaded", "processing", "completed", "failed"],
      },
      limit: {
        type: "number",
        description: "Maximum number of documents to return (default: 50)",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const limit = (args.limit as number) || 50;
    const conditions = [];

    if (args.documentType) {
      conditions.push(`document_type = '${args.documentType}'`);
    }
    if (args.searchTerm) {
      conditions.push(`file_name LIKE '%${args.searchTerm}%'`);
    }
    if (args.status) {
      conditions.push(`status = '${args.status}'`);
    }

    // Use project-specific table name
    const tableName = `proj_${context.projectId}_documents`;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT id, file_name, document_type, status, page_count,
             upload_date, acc_project_id, acc_folder_id, last_synced_at
      FROM ${tableName}
      ${whereClause}
      ORDER BY upload_date DESC
      LIMIT ${limit}
    `;

    const result = await context.projectDb.execute(query);
    const rows = result[0] as any[];

    return {
      documents: rows,
      count: rows.length,
      filters: {
        documentType: args.documentType,
        searchTerm: args.searchTerm,
        status: args.status,
      },
    };
  },
};

export const queryRedFlagsTool: ToolDefinition = {
  name: "query_red_flags",
  description: "Query red flags (risks) identified in the project. Can filter by category or severity.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Filter by red flag category",
      },
      severity: {
        type: "string",
        description: "Filter by severity level",
        enum: ["low", "medium", "high", "critical"],
      },
      mitigated: {
        type: "string",
        description: "Filter by mitigation status (true/false)",
        enum: ["true", "false"],
      },
      limit: {
        type: "number",
        description: "Maximum number of red flags to return (default: 50)",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const limit = (args.limit as number) || 50;
    const conditions = [];

    if (args.category) {
      conditions.push(`category = '${args.category}'`);
    }
    if (args.severity) {
      conditions.push(`severity = '${args.severity}'`);
    }
    if (args.mitigated) {
      conditions.push(`mitigated = ${args.mitigated === "true" ? 1 : 0}`);
    }

    // Use project-specific table name
    const tableName = `proj_${context.projectId}_red_flags`;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT id, category, title, description, severity, 
             trigger_fact_id, downstream_consequences, mitigated, created_at
      FROM ${tableName}
      ${whereClause}
      ORDER BY 
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        created_at DESC
      LIMIT ${limit}
    `;

    const result = await context.projectDb.execute(query);
    const rows = result[0] as any[];

    return {
      redFlags: rows,
      count: rows.length,
      filters: {
        category: args.category,
        severity: args.severity,
        mitigated: args.mitigated,
      },
    };
  },
};

export const getFactByIdTool: ToolDefinition = {
  name: "get_fact_by_id",
  description: "Get detailed information about a specific fact by its ID.",
  parameters: {
    type: "object",
    properties: {
      factId: {
        type: "string",
        description: "The unique identifier of the fact",
      },
    },
    required: ["factId"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    // Use project-specific table names
    const factsTable = `proj_${context.projectId}_extracted_facts`;
    const docsTable = `proj_${context.projectId}_documents`;
    const query = `
      SELECT ef.*, d.file_name as source_document_name
      FROM ${factsTable} ef
      LEFT JOIN ${docsTable} d ON ef.source_document_id = d.id
      WHERE ef.id = ?
    `;

    const result = await context.projectDb.execute(query, [args.factId]);
    const rows = result[0] as any[];

    if (rows.length === 0) {
      throw new Error(`Fact with ID ${args.factId} not found`);
    }

    return rows[0];
  },
};

export const getProjectSummaryTool: ToolDefinition = {
  name: "get_project_summary",
  description: "Get a high-level summary of the project including counts of documents, facts, and red flags.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    // Use project-specific table names
    const docsTable = `proj_${context.projectId}_documents`;
    const factsTable = `proj_${context.projectId}_extracted_facts`;
    const redFlagsTable = `proj_${context.projectId}_red_flags`;

    // Get counts
    const result1 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM ${docsTable}`);
    const docCount = result1[0] as any[];
    
    const result2 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM ${factsTable}`);
    const factCount = result2[0] as any[];
    
    const result3 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM ${redFlagsTable}`);
    const redFlagCount = result3[0] as any[];

    // Get red flag breakdown by severity
    const result4 = await context.projectDb.execute(
      `SELECT severity, COUNT(*) as count 
       FROM ${redFlagsTable}
       GROUP BY severity`);
    const severityBreakdown = result4[0] as any[];

    // Get document type breakdown
    const result5 = await context.projectDb.execute(
      `SELECT document_type, COUNT(*) as count 
       FROM ${docsTable}
       GROUP BY document_type`);
    const docTypeBreakdown = result5[0] as any[];

    return {
      projectId: context.projectId,
      documentCount: docCount[0]?.count || 0,
      factCount: factCount[0]?.count || 0,
      redFlagCount: redFlagCount[0]?.count || 0,
      redFlagsBySeverity: severityBreakdown,
      documentsByType: docTypeBreakdown,
    };
  },
};

// Export all query tools
export const queryTools: ToolDefinition[] = [
  queryFactsTool,
  queryDocumentsTool,
  queryRedFlagsTool,
  getFactByIdTool,
  getProjectSummaryTool,
];
