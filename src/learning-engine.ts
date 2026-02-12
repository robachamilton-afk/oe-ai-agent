import { v4 as uuidv4 } from "uuid";
import { eq, and, desc, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { invokeLLM } from "./llm";
import {
  agentLearningSamples,
  agentStyleModels,
  agentGeneratedContent,
  type InsertAgentLearningSample,
  type InsertAgentStyleModel,
} from "./schema";

/**
 * Learning Engine
 * 
 * Analyzes user edits to generated content and extracts writing patterns
 * Updates persistent style model to improve future generations
 */

export interface EditAnalysis {
  addedPhrases: string[];
  removedPhrases: string[];
  styleChanges: string[];
  structuralChanges: string[];
  editDistance: number;
}

export interface StylePatterns {
  sentenceStructure?: string[];
  technicalDepth?: string;
  riskFraming?: string;
  terminology?: Record<string, string>;
  formatPreferences?: Record<string, string>;
}

export class LearningEngine {
  constructor(private db: MySql2Database<any>) {}

  /**
   * Submit user edit for learning
   */
  async submitEdit(
    contentId: string,
    finalContent: string,
    feedback?: string
  ): Promise<void> {
    // Get the original generated content
    const [generated] = await this.db
      .select()
      .from(agentGeneratedContent)
      .where(eq(agentGeneratedContent.id, contentId));
    if (!generated) {
      throw new Error(`Generated content ${contentId} not found`);
    }

    // Update the generated content record
    await this.db
      .update(agentGeneratedContent)
      .set({
        finalVersion: finalContent,
        userEdited: finalContent === generated.content ? 0 : 1,
        updatedAt: new Date(),
      })
      .where(eq(agentGeneratedContent.id, contentId));

    // If content was accepted without changes, no learning needed
    if (finalContent === generated.content) {
      return;
    }

    // Analyze the edit
    const analysis = await this.analyzeEdit(
      generated.content,
      finalContent
    );

    // Create learning sample
    const sampleId = uuidv4();
    await this.db.insert(agentLearningSamples).values({
      id: sampleId,
      userId: generated.userId,
      projectId: generated.projectId,
      contentType: generated.contentType,
      draftContent: generated.content,
      finalContent,
      extractedPatterns: {
        addedPhrases: analysis.addedPhrases,
        removedPhrases: analysis.removedPhrases,
        styleChanges: analysis.styleChanges,
        structuralChanges: analysis.structuralChanges,
      },
      editDistance: analysis.editDistance,
      applied: 0,
    });

    // Update style model
    await this.updateStyleModel(generated.userId, analysis);
  }

  /**
   * Analyze differences between draft and final content
   */
  private async analyzeEdit(
    draftContent: string,
    finalContent: string
  ): Promise<EditAnalysis> {
    // Use LLM to analyze the edit
    const prompt = `Analyze the differences between the draft and final content below.
Extract:
1. Phrases/sentences that were added
2. Phrases/sentences that were removed
3. Style changes (tone, formality, technical depth)
4. Structural changes (organization, formatting)

Draft Content:
${draftContent}

Final Content:
${finalContent}

Provide your analysis in JSON format.`;

    try {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "You are an expert in analyzing writing style and content changes.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 2000,
      });

      const content = response?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty LLM response");
      }
      const analysis = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

      // Calculate simple edit distance (Levenshtein-like)
      const editDistance = this.calculateEditDistance(draftContent, finalContent);

      return {
        addedPhrases: analysis.addedPhrases || [],
        removedPhrases: analysis.removedPhrases || [],
        styleChanges: analysis.styleChanges || [],
        structuralChanges: analysis.structuralChanges || [],
        editDistance,
      };
    } catch (error) {
      console.error("Failed to analyze edit with LLM:", error);
      
      // Fallback to simple analysis
      return {
        addedPhrases: [],
        removedPhrases: [],
        styleChanges: [],
        structuralChanges: [],
        editDistance: this.calculateEditDistance(draftContent, finalContent),
      };
    }
  }

  /**
   * Calculate edit distance between two strings
   * Uses word-level comparison to prevent memory issues with large documents.
   * Character-level Levenshtein on large docs (>5000 chars) would create
   * a matrix too large for memory (O(n*m)).
   */
  private calculateEditDistance(str1: string, str2: string): number {
    // Split into words for word-level comparison
    const words1 = str1.split(/\s+/).filter(Boolean);
    const words2 = str2.split(/\s+/).filter(Boolean);

    // Cap at 2000 words to prevent memory issues
    const w1 = words1.slice(0, 2000);
    const w2 = words2.slice(0, 2000);
    const len1 = w1.length;
    const len2 = w2.length;

    // Use two-row optimization to reduce memory from O(n*m) to O(min(n,m))
    let prev = new Array(len2 + 1);
    let curr = new Array(len2 + 1);

    for (let j = 0; j <= len2; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      curr[0] = i;
      for (let j = 1; j <= len2; j++) {
        if (w1[i - 1] === w2[j - 1]) {
          curr[j] = prev[j - 1];
        } else {
          curr[j] = Math.min(
            prev[j - 1] + 1, // substitution
            curr[j - 1] + 1, // insertion
            prev[j] + 1      // deletion
          );
        }
      }
      [prev, curr] = [curr, prev];
    }

    return prev[len2];
  }

  /**
   * Update user's style model based on edit analysis
   */
  private async updateStyleModel(
    userId: number,
    analysis: EditAnalysis
  ): Promise<void> {
    // Get current style model
    const [currentModel] = await this.db
      .select()
      .from(agentStyleModels)
      .where(eq(agentStyleModels.userId, userId))
      .orderBy(desc(agentStyleModels.version))
      .limit(1);

    // Extract patterns from analysis
    const newPatterns = await this.extractPatterns(analysis);

    if (currentModel) {
      // Merge with existing patterns
      const mergedPatterns = this.mergePatterns(
        (currentModel.patterns || {}) as StylePatterns,
        newPatterns
      );

      // Update statistics - clone to avoid mutating the original object
      const rawStats = currentModel.statistics || {};
      const stats = {
        totalEdits: (rawStats as any).totalEdits || 0,
        totalGenerations: (rawStats as any).totalGenerations || 0,
        averageEditDistance: (rawStats as any).averageEditDistance || 0,
        improvementScore: (rawStats as any).improvementScore || 0,
      };

      stats.totalEdits += 1;
      stats.averageEditDistance =
        (stats.averageEditDistance * (stats.totalEdits - 1) + analysis.editDistance) /
        stats.totalEdits;

      // Update existing model
      await this.db
        .update(agentStyleModels)
        .set({
          patterns: mergedPatterns,
          statistics: stats,
          version: sql`${agentStyleModels.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(agentStyleModels.userId, userId));
    } else {
      // Create new style model
      const modelId = uuidv4();
      await this.db.insert(agentStyleModels).values({
        id: modelId,
        userId,
        version: 1,
        patterns: newPatterns,
        statistics: {
          totalEdits: 1,
          totalGenerations: 0,
          averageEditDistance: analysis.editDistance,
          improvementScore: 0,
        },
      });
    }
  }

  /**
   * Extract style patterns from edit analysis
   */
  private async extractPatterns(analysis: EditAnalysis): Promise<StylePatterns> {
    // Use LLM to extract high-level patterns
    const prompt = `Based on these content changes, identify the user's writing style preferences:

Added phrases: ${JSON.stringify(analysis.addedPhrases)}
Removed phrases: ${JSON.stringify(analysis.removedPhrases)}
Style changes: ${JSON.stringify(analysis.styleChanges)}
Structural changes: ${JSON.stringify(analysis.structuralChanges)}

Extract:
1. Preferred sentence structure patterns
2. Technical depth preference (high/medium/low)
3. Risk framing style (conservative/balanced/optimistic)
4. Terminology preferences (preferred terms vs avoided terms)

Provide your analysis in JSON format.`;

    try {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "You are an expert in analyzing writing style patterns.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 1500,
      });

      const patternContent = response?.choices?.[0]?.message?.content;
      if (!patternContent) {
        return {};
      }
      return JSON.parse(typeof patternContent === "string" ? patternContent : JSON.stringify(patternContent));
    } catch (error) {
      console.error("Failed to extract patterns with LLM:", error);
      return {};
    }
  }

  /**
   * Merge new patterns with existing patterns
   */
  private mergePatterns(
    existing: StylePatterns,
    newPatterns: StylePatterns
  ): StylePatterns {
    return {
      sentenceStructure: [
        ...(existing.sentenceStructure || []),
        ...(newPatterns.sentenceStructure || []),
      ].slice(-20), // Keep last 20 patterns
      technicalDepth: newPatterns.technicalDepth || existing.technicalDepth,
      riskFraming: newPatterns.riskFraming || existing.riskFraming,
      terminology: {
        ...(existing.terminology || {}),
        ...(newPatterns.terminology || {}),
      },
      formatPreferences: {
        ...(existing.formatPreferences || {}),
        ...(newPatterns.formatPreferences || {}),
      },
    };
  }

  /**
   * Get user's current style model
   */
  async getStyleModel(userId: number): Promise<StylePatterns | null> {
    const [model] = await this.db
      .select({ patterns: agentStyleModels.patterns })
      .from(agentStyleModels)
      .where(eq(agentStyleModels.userId, userId))
      .orderBy(desc(agentStyleModels.version))
      .limit(1);

    return model ? model.patterns as StylePatterns : null;
  }

  /**
   * Get learning statistics for a user
   */
  async getLearningStats(userId: number): Promise<{
    totalEdits: number;
    totalGenerations: number;
    averageEditDistance: number;
    improvementScore: number;
    styleModelVersion: number;
  }> {
    const [model] = await this.db
      .select({
        statistics: agentStyleModels.statistics,
        version: agentStyleModels.version,
      })
      .from(agentStyleModels)
      .where(eq(agentStyleModels.userId, userId))
      .orderBy(desc(agentStyleModels.version))
      .limit(1);
    if (!model) {
      return {
        totalEdits: 0,
        totalGenerations: 0,
        averageEditDistance: 0,
        improvementScore: 0,
        styleModelVersion: 0,
      };
    }

    const stats = model.statistics as any || {};
    return {
      totalEdits: stats.totalEdits || 0,
      totalGenerations: stats.totalGenerations || 0,
      averageEditDistance: stats.averageEditDistance || 0,
      improvementScore: stats.improvementScore || 0,
      styleModelVersion: model.version,
    };
  }

  /**
   * Get recent learning samples for review
   */
  async getRecentSamples(
    userId: number,
    limit: number = 10
  ): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(agentLearningSamples)
      .where(eq(agentLearningSamples.userId, userId))
      .orderBy(desc(agentLearningSamples.createdAt))
      .limit(limit);

    return rows;
  }
}
