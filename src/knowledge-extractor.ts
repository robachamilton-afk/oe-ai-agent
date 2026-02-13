import { v4 as uuidv4 } from "uuid";
import { eq, like, sql, desc } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { invokeLLM } from "./llm";
import { agentKnowledgeBase } from "./schema";

/**
 * Knowledge Extractor
 * 
 * Automatically extracts de-identified insights from completed conversations
 * and tool results, then stores them in the global knowledge base.
 * 
 * This runs asynchronously after each conversation to avoid blocking responses.
 * It uses the LLM to identify generalizable patterns, benchmarks, and lessons
 * that would be useful across projects.
 */

export interface ConversationSummary {
  projectId: number;
  userMessage: string;
  agentResponse: string;
  toolResults: Array<{
    name: string;
    result: unknown;
  }>;
}

export class KnowledgeExtractor {
  constructor(private db: MySql2Database<any>) {}

  /**
   * Extract and store insights from a completed conversation turn.
   * This runs asynchronously — fire and forget — so it doesn't block the response.
   */
  async extractFromConversation(summary: ConversationSummary): Promise<void> {
    try {
      // Only extract if there were meaningful tool results
      if (summary.toolResults.length === 0) {
        return;
      }

      // Build a condensed summary of what happened
      const toolSummary = summary.toolResults.map(tr => {
        const resultStr = JSON.stringify(tr.result);
        // Truncate large results to avoid token waste
        const truncated = resultStr.length > 2000 
          ? resultStr.substring(0, 2000) + "...[truncated]"
          : resultStr;
        return `Tool: ${tr.name}\nResult: ${truncated}`;
      }).join("\n\n");

      // Ask the LLM to extract generalizable insights
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a knowledge extraction engine for a renewable energy due diligence platform. 
Your job is to analyze completed agent interactions and extract GENERALIZABLE insights that would be useful for future projects.

RULES:
- Only extract insights that are NOT project-specific (no project names, specific contract values, or confidential data)
- Focus on patterns, benchmarks, regulatory requirements, technical standards, and lessons learned
- Each insight should be useful across multiple projects
- If there's nothing generalizable to extract, return an empty array
- Be selective — only extract truly valuable knowledge, not obvious facts

Return JSON in this exact format:
{
  "insights": [
    {
      "category": "benchmark|best_practice|pattern|regional_insight|regulatory|technical_standard|lesson_learned",
      "topic": "Brief topic title",
      "content": "Detailed insight description",
      "confidence": "low|medium|high",
      "tags": ["tag1", "tag2"],
      "applicability": ["solar", "MENA", "utility-scale"]
    }
  ]
}

If no generalizable insights can be extracted, return: { "insights": [] }`,
          },
          {
            role: "user",
            content: `Analyze this agent interaction and extract any generalizable knowledge:

USER QUESTION: ${summary.userMessage}

TOOL RESULTS:
${toolSummary}

AGENT RESPONSE: ${summary.agentResponse.substring(0, 3000)}

Extract any generalizable insights (benchmarks, patterns, best practices, regulatory info) that would be useful for analyzing other renewable energy projects.`,
          },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 2000,
      });

      const content = response?.choices?.[0]?.message?.content;
      if (!content) return;

      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      const insights = parsed.insights || [];

      if (insights.length === 0) {
        console.log("[KNOWLEDGE EXTRACTOR] No generalizable insights found in this conversation.");
        return;
      }

      // For each insight, check if similar knowledge already exists
      for (const insight of insights) {
        const isDuplicate = await this.checkForDuplicate(insight.topic, insight.content);
        
        if (isDuplicate.exists) {
          // Strengthen existing knowledge by incrementing source count
          console.log(`[KNOWLEDGE EXTRACTOR] Strengthening existing knowledge: "${isDuplicate.existingTopic}" (source count +1)`);
          await this.db
            .update(agentKnowledgeBase)
            .set({
              sourceCount: sql`${agentKnowledgeBase.sourceCount} + 1`,
              // Upgrade confidence if we keep seeing the same pattern
              confidence: isDuplicate.currentSourceCount >= 3 ? "high" 
                : isDuplicate.currentSourceCount >= 1 ? "medium" 
                : insight.confidence,
            })
            .where(eq(agentKnowledgeBase.id, isDuplicate.existingId!));
        } else {
          // Add new knowledge
          const id = uuidv4();
          await this.db.insert(agentKnowledgeBase).values({
            id,
            category: insight.category || "pattern",
            topic: insight.topic,
            content: insight.content,
            confidence: insight.confidence || "medium",
            sourceCount: 1,
            metadata: {
              tags: insight.tags || [],
              relatedTopics: [],
              applicability: insight.applicability || [],
            },
          });
          console.log(`[KNOWLEDGE EXTRACTOR] New knowledge added: "${insight.topic}" (${insight.category})`);
        }
      }

      console.log(`[KNOWLEDGE EXTRACTOR] Processed ${insights.length} insights from conversation.`);
    } catch (error) {
      // Never let extraction errors affect the main flow
      console.error("[KNOWLEDGE EXTRACTOR] Error extracting knowledge:", error);
    }
  }

  /**
   * Check if similar knowledge already exists in the knowledge base.
   * Uses keyword matching on topic and content to find duplicates.
   */
  private async checkForDuplicate(
    topic: string,
    content: string
  ): Promise<{
    exists: boolean;
    existingId?: string;
    existingTopic?: string;
    currentSourceCount: number;
  }> {
    // Extract key terms from the topic
    const keywords = topic.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 4);

    if (keywords.length === 0) {
      return { exists: false, currentSourceCount: 0 };
    }

    // Search for entries with matching keywords in topic
    const conditions = keywords.map(
      kw => sql`LOWER(${agentKnowledgeBase.topic}) LIKE ${`%${kw}%`}`
    );

    const matches = await this.db
      .select({
        id: agentKnowledgeBase.id,
        topic: agentKnowledgeBase.topic,
        sourceCount: agentKnowledgeBase.sourceCount,
      })
      .from(agentKnowledgeBase)
      .where(sql`(${sql.join(conditions, sql` AND `)})`)
      .limit(5);

    if (matches.length > 0) {
      // Return the best match (most keywords matched)
      return {
        exists: true,
        existingId: matches[0].id,
        existingTopic: matches[0].topic,
        currentSourceCount: matches[0].sourceCount || 1,
      };
    }

    return { exists: false, currentSourceCount: 0 };
  }

  /**
   * Get knowledge base statistics
   */
  async getStats(): Promise<{
    totalEntries: number;
    byCategory: Record<string, number>;
    highConfidence: number;
    averageSourceCount: number;
  }> {
    const all = await this.db
      .select({
        category: agentKnowledgeBase.category,
        confidence: agentKnowledgeBase.confidence,
        sourceCount: agentKnowledgeBase.sourceCount,
      })
      .from(agentKnowledgeBase);

    const byCategory: Record<string, number> = {};
    let highConfidence = 0;
    let totalSourceCount = 0;

    for (const entry of all) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      if (entry.confidence === "high") highConfidence++;
      totalSourceCount += entry.sourceCount || 1;
    }

    return {
      totalEntries: all.length,
      byCategory,
      highConfidence,
      averageSourceCount: all.length > 0 ? totalSourceCount / all.length : 0,
    };
  }
}
