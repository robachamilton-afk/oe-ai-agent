import { sql } from "drizzle-orm";
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
    try {
      if (!context.projectDb) {
        throw new Error("Project database not available");
      }

      const limit = (args.limit as number) || 50;

      console.log("[QUERY_FACTS DEBUG] Starting query_facts with args:", args);
      console.log("[QUERY_FACTS DEBUG] Context projectId:", context.projectId);
      console.log("[QUERY_FACTS DEBUG] Context projectDb exists:", !!context.projectDb);

      // Build conditions
      const whereConditions: string[] = [];
      const values: any[] = [];
      
      if (args.category) {
        // Search in category (metadata) OR value (content)
        whereConditions.push('(category LIKE ? OR value LIKE ?)');
        values.push(`%${args.category}%`, `%${args.category}%`);
      }
      if (args.key) {
        // Search in key (metadata) OR value (content)
        whereConditions.push('(`key` LIKE ? OR value LIKE ?)');
        values.push(`%${args.key}%`, `%${args.key}%`);
      }
      if (args.searchTerm) {
        // Search across all fields: value (content), category, and key (metadata)
        whereConditions.push('(value LIKE ? OR category LIKE ? OR `key` LIKE ?)');
        values.push(`%${args.searchTerm}%`, `%${args.searchTerm}%`, `%${args.searchTerm}%`);
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
        // Use OR between conditions to find facts matching ANY criteria
        // This allows flexible searches where category OR key OR searchTerm can match
        query += ` WHERE ${whereConditions.join(" OR ")}`;
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
      };
    } catch (error) {
      console.error("[QUERY_FACTS ERROR]", error);
      throw error;
    }
  },
};

export const listFactCategoriesTool: ToolDefinition = {
  name: "list_fact_categories",
  description: "List all available fact categories and keys with counts. Use this to discover what data exists before querying specific facts. Can group by category only or by category+key combination.",
  parameters: {
    type: "object",
    properties: {
      groupBy: {
        type: "string",
        description: "Group results by 'category' (default) or 'key' (shows category+key combinations)",
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

    const groupBy = (args.groupBy as string) || "category";
    const limit = (args.limit as number) || 100;
    const tableName = `proj_${context.projectId}_extractedFacts`;

    let query: string;
    if (groupBy === "key") {
      query = `
        SELECT category, \`key\`, COUNT(*) as count
        FROM ${tableName}
        GROUP BY category, \`key\`
        ORDER BY count DESC
        LIMIT ${limit}
      `;
    } else {
      query = `
        SELECT category, COUNT(*) as count
        FROM ${tableName}
        GROUP BY category
        ORDER BY count DESC
        LIMIT ${limit}
      `;
    }

    const result = await context.projectDb.execute(query);
    const rows = result[0] as any[];

    // Get total fact count
    const countQuery = `SELECT COUNT(*) as total FROM ${tableName}`;
    const countResult = await context.projectDb.execute(countQuery);
    const totalFacts = (countResult[0] as any[])[0].total;

    return {
      groupBy,
      items: rows,
      count: rows.length,
      totalFacts,
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
      },
      searchTerm: {
        type: "string",
        description: "Search term to find in file names",
      },
      status: {
        type: "string",
        description: "Filter by processing status",
        enum: ["pending", "processing", "completed", "failed"],
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
      conditions.push(`documentType = '${args.documentType}'`);
    }
    if (args.searchTerm) {
      conditions.push(`fileName LIKE '%${args.searchTerm}%'`);
    }
    if (args.status) {
      conditions.push(`status = '${args.status}'`);
    }

    // Use project-specific table name
    const tableName = `proj_${context.projectId}_documents`;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT id, fileName, documentType, status, pageCount, uploadedAt, processedAt
      FROM ${tableName}
      ${whereClause}
      ORDER BY uploadedAt DESC
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
  description: "Query red flags (risks and issues) identified in the project. Red flags are stored as facts with category='Risks_And_Issues'. Can search by key or value.",
  parameters: {
    type: "object",
    properties: {
      searchTerm: {
        type: "string",
        description: "Search term to find in risk/issue facts (searches key and value fields)",
      },
      severity: {
        type: "string",
        description: "Filter by severity level (high, medium, low, critical)",
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
    const whereConditions: string[] = [];
    const values: any[] = [];

    // Red flags are stored in extractedFacts with category='Risks_And_Issues'
    whereConditions.push('category = ?');
    values.push('Risks_And_Issues');

    if (args.searchTerm) {
      whereConditions.push('(`key` LIKE ? OR value LIKE ?)');
      values.push(`%${args.searchTerm}%`, `%${args.searchTerm}%`);
    }
    
    if (args.severity) {
      whereConditions.push('(`key` LIKE ? OR value LIKE ?)');
      values.push(`%${args.severity}%`, `%${args.severity}%`);
    }

    // Use project-specific extractedFacts table
    const tableName = `proj_${context.projectId}_extractedFacts`;
    const query = `
      SELECT id, category, \`key\`, value, data_type, confidence, 
             source_document_id, extraction_method, verified, created_at
      FROM ${tableName}
      WHERE ${whereConditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    console.log("[QUERY_RED_FLAGS DEBUG] Executing query:", query);
    console.log("[QUERY_RED_FLAGS DEBUG] Query values:", values);
    const result = await context.projectDb.execute(query, values);
    const rows = result[0] as any[];
    console.log("[QUERY_RED_FLAGS DEBUG] Rows found:", rows?.length || 0);

    return {
      redFlags: rows,
      count: rows.length,
    };
  },
};

export const getFactByIdTool: ToolDefinition = {
  name: "get_fact_by_id",
  description: "Get a specific fact by its ID. Useful for retrieving detailed information about a fact mentioned in another query.",
  parameters: {
    type: "object",
    properties: {
      factId: {
        type: "string",
        description: "The ID of the fact to retrieve",
      },
    },
    required: ["factId"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    // Use project-specific table name
    const tableName = `proj_${context.projectId}_extractedFacts`;
    const query = `
      SELECT id, category, \`key\`, value, data_type, confidence, 
             source_document_id, extraction_method, verified, created_at,
             metadata
      FROM ${tableName}
      WHERE id = ?
    `;

    const result = await context.projectDb.execute(query, [args.factId]);
    const rows = result[0] as any[];

    if (rows.length === 0) {
      return {
        fact: null,
        error: "Fact not found",
      };
    }

    // Get source document info if available
    let sourceDocument = null;
    if (rows[0].source_document_id) {
      const docQuery = `
        SELECT id, fileName, documentType
        FROM proj_${context.projectId}_documents
        WHERE id = ?
      `;
      const docResult = await context.projectDb.execute(docQuery, [rows[0].source_document_id]);
      const docRows = docResult[0] as any[];
      if (docRows.length > 0) {
        sourceDocument = docRows[0];
      }
    }

    return {
      fact: rows[0],
      sourceDocument,
    };
  },
};

export const getProjectSummaryTool: ToolDefinition = {
  name: "get_project_summary",
  description: "Get a high-level summary of the project including document count, fact count by category, and red flag count. Use this to get an overview before diving into specific queries.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    // Get document count
    const docQuery = `SELECT COUNT(*) as count FROM proj_${context.projectId}_documents`;
    const docResult = await context.projectDb.execute(docQuery);
    const documentCount = (docResult[0] as any[])[0].count;

    // Get fact count by category
    const factQuery = `
      SELECT category, COUNT(*) as count 
      FROM proj_${context.projectId}_extractedFacts 
      GROUP BY category 
      ORDER BY count DESC
    `;
    const factResult = await context.projectDb.execute(factQuery);
    const factsByCategory = factResult[0] as any[];

    // Get total fact count
    const totalFactQuery = `SELECT COUNT(*) as count FROM proj_${context.projectId}_extractedFacts`;
    const totalFactResult = await context.projectDb.execute(totalFactQuery);
    const totalFactCount = (totalFactResult[0] as any[])[0].count;

    // Get red flag count (facts with category='Risks_And_Issues')
    const redFlagQuery = `
      SELECT COUNT(*) as count 
      FROM proj_${context.projectId}_extractedFacts 
      WHERE category = 'Risks_And_Issues'
    `;
    const redFlagResult = await context.projectDb.execute(redFlagQuery);
    const redFlagCount = (redFlagResult[0] as any[])[0].count;

    // Get sample high-value facts (top 10 by confidence)
    const sampleFactsQuery = `
      SELECT category, \`key\`, value, confidence
      FROM proj_${context.projectId}_extractedFacts
      WHERE category != 'Risks_And_Issues'
      ORDER BY confidence DESC
      LIMIT 10
    `;
    const sampleFactsResult = await context.projectDb.execute(sampleFactsQuery);
    const sampleFacts = sampleFactsResult[0] as any[];

    return {
      documentCount,
      factCount: totalFactCount,
      factsByCategory,
      redFlagCount,
      sampleFacts,
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
