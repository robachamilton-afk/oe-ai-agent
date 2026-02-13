import type { ToolDefinition } from "../tool-executor";
import { v4 as uuidv4 } from "uuid";
import { eq, and, like, desc, sql } from "drizzle-orm";
import { agentKnowledgeBase } from "../schema";

/**
 * Knowledge Base Tools
 * 
 * Read, write, search, and manage the global knowledge base.
 * This is the agent's persistent memory — insights learned from projects,
 * industry best practices, and domain knowledge that persists across
 * all projects and conversations.
 */

// ============================================================
// SEARCH KNOWLEDGE BASE
// ============================================================

export const searchKnowledgeTool: ToolDefinition = {
  name: "search_knowledge_base",
  description: "Search the global knowledge base for relevant insights, best practices, and learned patterns. This is the agent's persistent memory — it contains knowledge accumulated from all projects and seeded domain expertise. Use this BEFORE answering questions to check if there's relevant accumulated knowledge. Search by topic keywords, category, or tags.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query — keywords or phrases to search for in topics and content (e.g., 'DC/AC ratio', 'grid connection Oman', 'PPA pricing')",
      },
      category: {
        type: "string",
        description: "Optional: filter by knowledge category",
        enum: ["domain_knowledge", "best_practice", "pattern", "benchmark", "lesson_learned", "regional_insight", "regulatory", "technical_standard"],
      },
    },
    required: ["query"],
  },
  handler: async (args, context) => {
    const query = args.query as string;
    const category = args.category as string | undefined;

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);

    // Build WHERE conditions
    const conditions: any[] = [];
    
    // Search across topic and content fields
    for (const keyword of keywords.slice(0, 5)) {
      conditions.push(
        sql`(LOWER(${agentKnowledgeBase.topic}) LIKE ${`%${keyword}%`} OR LOWER(${agentKnowledgeBase.content}) LIKE ${`%${keyword}%`})`
      );
    }

    if (category) {
      conditions.push(eq(agentKnowledgeBase.category, category));
    }

    let queryBuilder = context.db
      .select()
      .from(agentKnowledgeBase);

    if (conditions.length > 0) {
      // Use OR for keyword matching so any keyword match returns results
      if (category) {
        queryBuilder = queryBuilder.where(
          and(
            eq(agentKnowledgeBase.category, category),
            sql`(${sql.join(conditions.filter(c => c !== conditions[conditions.length - 1]), sql` OR `)})`
          )
        ) as any;
      } else {
        queryBuilder = queryBuilder.where(
          sql`(${sql.join(conditions, sql` OR `)})`
        ) as any;
      }
    }

    const results = await queryBuilder
      .orderBy(desc(agentKnowledgeBase.updatedAt))
      .limit(20);

    if (results.length === 0) {
      return {
        found: false,
        message: `No knowledge base entries found for "${query}". This topic may not have been encountered yet.`,
        suggestion: "Consider adding relevant knowledge after completing analysis on this topic.",
      };
    }

    return {
      found: true,
      count: results.length,
      entries: results.map((r: any) => ({
        id: r.id,
        category: r.category,
        topic: r.topic,
        content: r.content,
        confidence: r.confidence,
        sourceCount: r.sourceCount,
        tags: r.metadata?.tags || [],
        relatedTopics: r.metadata?.relatedTopics || [],
        applicability: r.metadata?.applicability || [],
        updatedAt: r.updatedAt,
      })),
    };
  },
};

// ============================================================
// ADD KNOWLEDGE
// ============================================================

export const addKnowledgeTool: ToolDefinition = {
  name: "add_knowledge",
  description: "Add a new insight, best practice, or learned pattern to the global knowledge base. Use this when you discover something valuable during analysis that would be useful for future projects — for example, a regional regulatory pattern, a typical metric range, or a common risk pattern. Knowledge is de-identified and applies across projects.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Category of knowledge being added",
        enum: ["domain_knowledge", "best_practice", "pattern", "benchmark", "lesson_learned", "regional_insight", "regulatory", "technical_standard"],
      },
      topic: {
        type: "string",
        description: "Brief topic title (e.g., 'Solar DC/AC Ratio Best Practice', 'Oman Grid Connection Requirements')",
      },
      content: {
        type: "string",
        description: "The knowledge content — detailed insight, best practice, or pattern description. Should be de-identified (no project-specific names or confidential data).",
      },
      confidence: {
        type: "string",
        description: "Confidence level in this knowledge",
        enum: ["low", "medium", "high"],
      },
      tags: {
        type: "string",
        description: "Comma-separated tags for categorization (e.g., 'solar,oman,grid,regulatory')",
      },
      relatedTopics: {
        type: "string",
        description: "Comma-separated related topics (e.g., 'grid connection,transmission,OETC')",
      },
      applicability: {
        type: "string",
        description: "Comma-separated applicability contexts (e.g., 'solar,MENA,utility-scale')",
      },
    },
    required: ["category", "topic", "content", "confidence"],
  },
  handler: async (args, context) => {
    const id = uuidv4();
    const tags = args.tags ? (args.tags as string).split(",").map(t => t.trim()) : [];
    const relatedTopics = args.relatedTopics ? (args.relatedTopics as string).split(",").map(t => t.trim()) : [];
    const applicability = args.applicability ? (args.applicability as string).split(",").map(t => t.trim()) : [];

    await context.db.insert(agentKnowledgeBase).values({
      id,
      category: args.category as string,
      topic: args.topic as string,
      content: args.content as string,
      confidence: args.confidence as string,
      sourceCount: 1,
      metadata: {
        tags,
        relatedTopics,
        applicability,
      },
    });

    return {
      success: true,
      id,
      message: `Knowledge entry added: "${args.topic}" (${args.category}, ${args.confidence} confidence)`,
    };
  },
};

// ============================================================
// UPDATE KNOWLEDGE
// ============================================================

export const updateKnowledgeTool: ToolDefinition = {
  name: "update_knowledge",
  description: "Update an existing knowledge base entry — for example, to increase confidence after seeing the same pattern in another project, to refine the content, or to add new tags. Use this to strengthen knowledge over time.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the knowledge entry to update",
      },
      content: {
        type: "string",
        description: "Updated content (leave empty to keep existing)",
      },
      confidence: {
        type: "string",
        description: "Updated confidence level",
        enum: ["low", "medium", "high"],
      },
      incrementSourceCount: {
        type: "string",
        description: "Set to 'true' to increment the source count (when this pattern is confirmed by another project)",
        enum: ["true", "false"],
      },
      additionalTags: {
        type: "string",
        description: "Comma-separated tags to add to existing tags",
      },
    },
    required: ["id"],
  },
  handler: async (args, context) => {
    const id = args.id as string;

    // Get existing entry
    const [existing] = await context.db
      .select()
      .from(agentKnowledgeBase)
      .where(eq(agentKnowledgeBase.id, id));

    if (!existing) {
      return { success: false, error: `Knowledge entry ${id} not found` };
    }

    const updates: any = {};

    if (args.content) {
      updates.content = args.content as string;
    }
    if (args.confidence) {
      updates.confidence = args.confidence as string;
    }
    if (args.incrementSourceCount === "true") {
      updates.sourceCount = (existing.sourceCount || 1) + 1;
    }
    if (args.additionalTags) {
      const existingTags = (existing.metadata as any)?.tags || [];
      const newTags = (args.additionalTags as string).split(",").map(t => t.trim());
      const allTags = [...new Set([...existingTags, ...newTags])];
      updates.metadata = {
        ...(existing.metadata || {}),
        tags: allTags,
      };
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: "No updates provided" };
    }

    await context.db
      .update(agentKnowledgeBase)
      .set(updates)
      .where(eq(agentKnowledgeBase.id, id));

    return {
      success: true,
      message: `Knowledge entry "${existing.topic}" updated. Source count: ${updates.sourceCount || existing.sourceCount}`,
    };
  },
};

// ============================================================
// DELETE KNOWLEDGE
// ============================================================

export const deleteKnowledgeTool: ToolDefinition = {
  name: "delete_knowledge",
  description: "Delete a knowledge base entry. Use this to remove outdated, incorrect, or duplicate knowledge.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the knowledge entry to delete",
      },
      reason: {
        type: "string",
        description: "Reason for deletion (for audit purposes)",
      },
    },
    required: ["id", "reason"],
  },
  handler: async (args, context) => {
    const id = args.id as string;

    const [existing] = await context.db
      .select()
      .from(agentKnowledgeBase)
      .where(eq(agentKnowledgeBase.id, id));

    if (!existing) {
      return { success: false, error: `Knowledge entry ${id} not found` };
    }

    await context.db
      .delete(agentKnowledgeBase)
      .where(eq(agentKnowledgeBase.id, id));

    return {
      success: true,
      message: `Deleted knowledge entry: "${existing.topic}" (reason: ${args.reason})`,
    };
  },
};

// ============================================================
// LIST ALL KNOWLEDGE (by category)
// ============================================================

export const listKnowledgeTool: ToolDefinition = {
  name: "list_knowledge",
  description: "List all knowledge base entries, optionally filtered by category. Use this to see what the agent has learned and what knowledge is available.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Optional: filter by category",
        enum: ["domain_knowledge", "best_practice", "pattern", "benchmark", "lesson_learned", "regional_insight", "regulatory", "technical_standard"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    const category = args.category as string | undefined;

    let queryBuilder = context.db
      .select({
        id: agentKnowledgeBase.id,
        category: agentKnowledgeBase.category,
        topic: agentKnowledgeBase.topic,
        confidence: agentKnowledgeBase.confidence,
        sourceCount: agentKnowledgeBase.sourceCount,
        metadata: agentKnowledgeBase.metadata,
        updatedAt: agentKnowledgeBase.updatedAt,
      })
      .from(agentKnowledgeBase);

    if (category) {
      queryBuilder = queryBuilder.where(eq(agentKnowledgeBase.category, category)) as any;
    }

    const results = await queryBuilder
      .orderBy(desc(agentKnowledgeBase.updatedAt))
      .limit(50);

    // Group by category
    const grouped: Record<string, any[]> = {};
    for (const r of results) {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push({
        id: r.id,
        topic: r.topic,
        confidence: r.confidence,
        sourceCount: r.sourceCount,
        tags: (r.metadata as any)?.tags || [],
      });
    }

    return {
      totalEntries: results.length,
      byCategory: grouped,
    };
  },
};

// ============================================================
// EXPORT
// ============================================================

export const knowledgeBaseTools: ToolDefinition[] = [
  searchKnowledgeTool,
  addKnowledgeTool,
  updateKnowledgeTool,
  deleteKnowledgeTool,
  listKnowledgeTool,
];
