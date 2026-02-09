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
        finalContent,
        accepted: finalContent === generated.generatedContent,
        feedback,
        updatedAt: new Date(),
      })
      .where(eq(agentGeneratedContent.id, contentId));

    // If content was accepted without changes, no learning needed
    if (finalContent === generated.generatedContent) {
      return;
    }

    // Analyze the edit
    const analysis = await this.analyzeEdit(
      generated.generatedContent,
      finalContent
    );

    // Create learning sample
    const sampleId = uuidv4();
    await this.db.insert(agentLearningSamples).values({
      id: sampleId,
      userId: generated.userId,
      projectId: generated.projectId,
      contentType: generated.contentType,
      draftContent: generated.generatedContent,
      finalContent,
      extractedPatterns: {
        addedPhrases: analysis.addedPhrases,
        removedPhrases: analysis.removedPhrases,
        styleChanges: analysis.styleChanges,
        structuralChanges: analysis.structuralChanges,
      },
      editDistance: analysis.editDistance,
      applied: false,
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

      const analysis = JSON.parse(response.choices[0].message.content as string);

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
   */
  private calculateEditDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[len1][len2];
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
        currentModel.patterns as StylePatterns || {} as StylePatterns,
        newPatterns
      );

      // Update statistics
      const stats = currentModel.statistics || {
        totalEdits: 0,
        totalGenerations: 0,
        averageEditDistance: 0,
        improvementScore: 0,
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

      return JSON.parse(response.choices[0].message.content as string);
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
