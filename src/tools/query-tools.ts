import { eq, like, and, desc, sql } from "drizzle-orm";
import type { ToolDefinition } from "../tool-executor";

/**
 * Query Tools
 * 
 * Tools for querying project data (documents, facts, red flags)
 */

export const queryFactsTool: ToolDefinition = {
  name: "query_facts",
  description: "Query extracted facts from the project database. Uses flexible partial matching for category and key. Common categories: Project_Overview, Design_Parameters, Technical_Design, Financial, Location, Dependencies, Risks_And_Issues, Performance. Common keys: DC_Capacity, AC_Capacity, Project_Name, Location, Technology_Type, COD, Capacity_Factor.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Filter by fact category using partial match (e.g., 'design' matches 'Design_Parameters', 'technical' matches 'Technical_Design')",
      },
      key: {
        type: "string",
        description: "Filter by fact key using partial match (e.g., 'capacity' matches 'DC_Capacity' and 'AC_Capacity')",
      },
      searchTerm: {
        type: "string",
        description: "Search term to find in fact values, categories, or keys (searches all fields if category/key not specified)",
      },
      limit: {
        type: "number",
        description: "Maximum number of facts to return (default: 50)",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    console.log("[QUERY_FACTS DEBUG] Starting query_facts with args:", args);
    console.log("[QUERY_FACTS DEBUG] Context projectId:", context.projectId);
    console.log("[QUERY_FACTS DEBUG] Context projectDb exists:", !!context.projectDb);
    
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    try {
      const limit = (args.limit as number) || 50;
      // Build conditions
      const whereConditions: string[] = [];
      const values: any[] = [];
      
      if (args.category) {
        // Use LIKE for flexible partial matching
        whereConditions.push('category LIKE ?');
        values.push(`%${args.category}%`);
      }
      if (args.key) {
        // Use LIKE for flexible partial matching
        whereConditions.push('`key` LIKE ?');
        values.push(`%${args.key}%`);
      }
      if (args.searchTerm) {
        // Browse mode: if no category/key specified, search across all fields
        if (!args.category && !args.key) {
          whereConditions.push('(value LIKE ? OR category LIKE ? OR `key` LIKE ?)');
          values.push(`%${args.searchTerm}%`, `%${args.searchTerm}%`, `%${args.searchTerm}%`);
        } else {
          // If category/key specified, only search in value
          whereConditions.push('value LIKE ?');
          values.push(`%${args.searchTerm}%`);
        }
      }

      // Build and execute query
      // Use project-specific table name (e.g., proj_390002_extractedFacts)
      const tableName = `proj_${context.projectId}_extractedFacts`;
      let query = `
        SELECT id, category, \`key\`, value, data_type, confidence, 
               source_document_id, extraction_method, verified, created_at
        FROM ${tableName}
      `;

      if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(" AND ")}`;
      }

      query += ` ORDER BY created_at DESC LIMIT ${limit}`;

      console.log("[QUERY_FACTS DEBUG] Executing query:", query);
      console.log("[QUERY_FACTS DEBUG] Query values:", values);
      const result = await context.projectDb.execute(query, values);
      console.log("[QUERY_FACTS DEBUG] Query result:", result);
      const rows = result[0] as any[];
      console.log("[QUERY_FACTS DEBUG] Rows found:", rows?.length || 0);
      
      return {
        facts: rows,
        count: rows.length,
        filters: {
          category: args.category,
          key: args.key,
          searchTerm: args.searchTerm,
        },
      };
    } catch (error) {
      console.error("[QUERY_FACTS ERROR]", error);
      throw error;
    }
  },
};

export const listFactCategoriesTool: ToolDefinition = {
  name: "list_fact_categories",
  description: "List all available fact categories and keys in the project database with counts. Use this to discover what data exists before querying specific facts.",
  parameters: {
    type: "object",
    properties: {
      groupBy: {
        type: "string",
        description: "Group results by 'category' or 'key' (default: 'category')",
        enum: ["category", "key"],
      },
      limit: {
        type: "number",
        description: "Maximum number of groups to return (default: 100)",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    try {
      const groupBy = (args.groupBy as string) || "category";
      const limit = (args.limit as number) || 100;
      const tableName = `proj_${context.projectId}_extractedFacts`;

      let query: string;
      if (groupBy === "category") {
        query = `
          SELECT category, COUNT(*) as count
          FROM ${tableName}
          GROUP BY category
          ORDER BY count DESC
          LIMIT ${limit}
        `;
      } else {
        query = `
          SELECT category, \`key\`, COUNT(*) as count
          FROM ${tableName}
          GROUP BY category, \`key\`
          ORDER BY count DESC
          LIMIT ${limit}
        `;
      }

      const result = await context.projectDb.execute(query);
      const rows = result[0] as any[];

      return {
        groupBy,
        items: rows,
        count: rows.length,
        totalFacts: rows.reduce((sum: number, row: any) => sum + row.count, 0),
      };
    } catch (error) {
      console.error("[LIST_FACT_CATEGORIES ERROR]", error);
      throw error;
    }
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
      SELECT id, fileName, documentType, status, pageCount, uploadDate
      FROM ${tableName}
      ${whereClause}
      ORDER BY uploadDate DESC
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

    // Use project-specific table name (camelCase: redFlags, not red_flags)
    const tableName = `proj_${context.projectId}_redFlags`;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT id, category, title, description, severity, 
             triggerFactId, downstreamConsequences, mitigated, createdAt
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
        createdAt DESC
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
    const factsTable = `proj_${context.projectId}_extractedFacts`;
    const docsTable = `proj_${context.projectId}_documents`;
    const query = `
      SELECT ef.*, d.fileName as source_document_name
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
    // Note: All tables now use camelCase after migration
    const docsTable = `proj_${context.projectId}_documents`;
    const factsTable = `proj_${context.projectId}_extractedFacts`;
    const redFlagsTable = `proj_${context.projectId}_redFlags`;

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
      `SELECT documentType, COUNT(*) as count 
       FROM ${docsTable}
       GROUP BY documentType`);
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
  listFactCategoriesTool,
  queryDocumentsTool,
  queryRedFlagsTool,
  getFactByIdTool,
  getProjectSummaryTool,
];
