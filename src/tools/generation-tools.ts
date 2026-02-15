import { v4 as uuidv4 } from "uuid";
import { eq, desc } from "drizzle-orm";
import { invokeLLM } from "../llm";
import type { ToolDefinition } from "../tool-executor";
import { agentGeneratedContent, agentStyleModels } from "../schema";

/**
 * Content Generation Tools
 * 
 * Tools for generating technical reports, risk assessments, and narratives
 */

export const generateRiskNarrativeTool: ToolDefinition = {
  name: "generate_risk_narrative",
  description: "Generate a detailed risk narrative for a specific fact or red flag. Applies learned writing style.",
  parameters: {
    type: "object",
    properties: {
      factId: {
        type: "string",
        description: "The ID of the fact to generate a risk narrative for",
      },
      redFlagId: {
        type: "string",
        description: "The ID of the red flag to generate a narrative for (alternative to factId)",
      },
      tone: {
        type: "string",
        description: "The tone of the narrative",
        enum: ["technical", "executive", "detailed"],
      },
      includeRecommendations: {
        type: "string",
        description: "Whether to include mitigation recommendations",
        enum: ["true", "false"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    // Get the fact or red flag details
    let subject: any;
    if (args.factId) {
      const result = await context.projectDb.execute(
        `SELECT * FROM extractedFacts WHERE id = ? AND project_id = ?`,
        [args.factId, context.projectId]);
      const rows = result[0] as any[];
      subject = rows[0];
      if (!subject) throw new Error(`Fact ${args.factId} not found`);
    } else if (args.redFlagId) {
      const result = await context.projectDb.execute(
        `SELECT * FROM redFlags WHERE id = ? AND project_id = ?`,
        [args.redFlagId, context.projectId]);
      const rows = result[0] as any[];
      subject = rows[0];
      if (!subject) throw new Error(`Red flag ${args.redFlagId} not found`);
    } else {
      throw new Error("Either factId or redFlagId must be provided");
    }

    // Get user's style model (if available)
    const [styleModel] = await context.db
      .select()
      .from(agentStyleModels)
      .where(eq(agentStyleModels.userId, context.userId))
      .orderBy(desc(agentStyleModels.version))
      .limit(1);

    // Build the prompt
    const tone = args.tone || "technical";
    const includeRecommendations = args.includeRecommendations === "true";

    let prompt = `Generate a ${tone} risk narrative for the following:\n\n`;
    prompt += `Subject: ${JSON.stringify(subject, null, 2)}\n\n`;
    
    if (includeRecommendations) {
      prompt += "Include specific mitigation recommendations.\n\n";
    }

    if (styleModel?.patterns) {
      prompt += `Writing style preferences:\n`;
      prompt += `- Technical depth: ${styleModel.patterns.technicalDepth || "moderate"}\n`;
      prompt += `- Risk framing: ${styleModel.patterns.riskFraming || "balanced"}\n`;
      if (styleModel.patterns.terminology) {
        prompt += `- Preferred terminology: ${JSON.stringify(styleModel.patterns.terminology)}\n`;
      }
    }

    prompt += `\nGenerate a well-structured risk narrative that addresses:\n`;
    prompt += `1. Description of the risk/issue\n`;
    prompt += `2. Potential impacts and consequences\n`;
    prompt += `3. Severity assessment\n`;
    if (includeRecommendations) {
      prompt += `4. Recommended mitigation strategies\n`;
    }

    // Generate content using LLM
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an expert technical writer specializing in renewable energy project risk assessment.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      maxTokens: 2000,
    });

    const generatedContent = response?.choices?.[0]?.message?.content as string || "Error: Failed to generate content. Please try again.";

    // Save generated content for learning
    const contentId = uuidv4();
    await context.db.insert(agentGeneratedContent).values({
      id: contentId,
      userId: context.userId,
      projectId: context.projectId || 0,
      conversationId: context.conversationId ?? undefined,
      contentType: "risk_narrative",
      prompt,
      content: generatedContent,
      finalVersion: undefined,
      userEdited: 0,
      modelVersion: styleModel?.version?.toString() ?? undefined,
      metadata: undefined,
    });

    return {
      contentId,
      narrative: generatedContent,
      metadata: {
        tone,
        includeRecommendations,
        styleModelVersion: styleModel?.version || null,
        tokens: response.usage?.total_tokens,
      },
    };
  },
};

export const generateProjectSummaryTool: ToolDefinition = {
  name: "generate_project_summary",
  description: "Generate an executive summary of the entire project based on all extracted facts and identified risks.",
  parameters: {
    type: "object",
    properties: {
      format: {
        type: "string",
        description: "The format of the summary",
        enum: ["executive", "technical", "comprehensive"],
      },
      focusAreas: {
        type: "string",
        description: "Comma-separated list of focus areas (e.g., 'risks,financials,technical')",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const format = args.format || "executive";
    const focusAreas = args.focusAreas 
      ? (args.focusAreas as string).split(",").map(a => a.trim())
      : ["overview", "risks", "key_facts"];

    // Gather project data
    const result1 = await context.projectDb.execute(
      `SELECT category, \`key\`, value FROM extractedFacts WHERE project_id = ? LIMIT 100`,
      [context.projectId]);
    const facts = result1[0] as any[];

    const result2 = await context.projectDb.execute(
      `SELECT category, title, severity FROM redFlags WHERE project_id = ? ORDER BY 
       CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END`,
      [context.projectId]);
    const redFlags = result2[0] as any[];

    const result3 = await context.projectDb.execute(
      `SELECT document_type, COUNT(*) as count FROM documents WHERE project_id = ? GROUP BY document_type`,
      [context.projectId]);
    const documents = result3[0] as any[];

    // Build prompt
    let prompt = `Generate a ${format} project summary based on the following data:\n\n`;
    prompt += `Focus areas: ${focusAreas.join(", ")}\n\n`;
    prompt += `Documents: ${JSON.stringify(documents, null, 2)}\n\n`;
    prompt += `Key Facts (sample): ${JSON.stringify(facts.slice(0, 20), null, 2)}\n\n`;
    prompt += `Red Flags: ${JSON.stringify(redFlags, null, 2)}\n\n`;
    prompt += `Generate a well-structured summary that covers the requested focus areas.`;

    // Generate content
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an expert renewable energy project analyst creating executive summaries.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      maxTokens: 3000,
    });

    const generatedContent = response?.choices?.[0]?.message?.content as string || "Error: Failed to generate content. Please try again.";

    // Save generated content
    const contentId = uuidv4();
    await context.db.insert(agentGeneratedContent).values({
      id: contentId,
      userId: context.userId,
      projectId: context.projectId || 0,
      conversationId: context.conversationId ?? undefined,
      contentType: "project_summary",
      prompt,
      content: generatedContent,
      finalVersion: undefined,
      userEdited: 0,
      modelVersion: undefined,
      metadata: undefined,
    });

    return {
      contentId,
      summary: generatedContent,
      metadata: {
        format,
        focusAreas,
        factCount: facts.length,
        redFlagCount: redFlags.length,
        tokens: response.usage?.total_tokens,
      },
    };
  },
};

export const generateTechnicalSpecificationTool: ToolDefinition = {
  name: "generate_technical_specification",
  description: "Generate a technical specification document based on extracted technical facts.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "The category of technical facts to include (e.g., 'solar', 'electrical', 'structural')",
      },
      includeCalculations: {
        type: "string",
        description: "Whether to include detailed calculations",
        enum: ["true", "false"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    // Get technical facts
    let query = `SELECT * FROM extractedFacts WHERE project_id = ?`;
    const params: any[] = [context.projectId];

    if (args.category) {
      query += ` AND category = ?`;
      params.push(args.category);
    }

    query += ` ORDER BY category, \`key\``;

    const result = await context.projectDb.execute(query, params);
    const facts = result[0] as any[];

    // Build prompt
    let prompt = `Generate a technical specification document based on these facts:\n\n`;
    prompt += JSON.stringify(facts, null, 2);
    prompt += `\n\nFormat the specification with:\n`;
    prompt += `1. Executive Summary\n`;
    prompt += `2. Technical Parameters (organized by category)\n`;
    prompt += `3. System Configuration\n`;
    if (args.includeCalculations === "true") {
      prompt += `4. Detailed Calculations and Derivations\n`;
    }
    prompt += `\nUse professional technical writing style with clear section headings.`;

    // Generate content
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a technical specification writer for renewable energy projects.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      maxTokens: 4000,
    });

    const generatedContent = response?.choices?.[0]?.message?.content as string || "Error: Failed to generate content. Please try again.";

    // Save generated content
    const contentId = uuidv4();
    await context.db.insert(agentGeneratedContent).values({
      id: contentId,
      userId: context.userId,
      projectId: context.projectId || 0,
      conversationId: context.conversationId ?? undefined,
      contentType: "technical_specification",
      prompt,
      content: generatedContent,
      finalVersion: undefined,
      userEdited: 0,
      modelVersion: undefined,
      metadata: undefined,
    });

    return {
      contentId,
      specification: generatedContent,
      metadata: {
        category: args.category,
        includeCalculations: args.includeCalculations === "true",
        factCount: facts.length,
        tokens: response.usage?.total_tokens,
      },
    };
  },
};

// Export all generation tools
export const generationTools: ToolDefinition[] = [
  generateRiskNarrativeTool,
  generateProjectSummaryTool,
  generateTechnicalSpecificationTool,
];
