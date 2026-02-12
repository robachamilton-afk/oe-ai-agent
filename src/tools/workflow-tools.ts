import type { ToolDefinition } from "../tool-executor";

/**
 * Workflow Tools
 * 
 * Tools for guiding users through multi-step processes and suggesting next actions
 */

export const getWorkflowStatusTool: ToolDefinition = {
  name: "get_workflow_status",
  description: "Get the current status of project workflows and identify what steps are complete or missing.",
  parameters: {
    type: "object",
    properties: {
      workflow: {
        type: "string",
        description: "The workflow to check status for",
        enum: ["project_setup", "document_ingestion", "fact_extraction", "deliverables_prep", "all"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const workflow = (args.workflow as string) || "all";
    const status: Record<string, any> = {};

    // Check document ingestion workflow
    if (workflow === "document_ingestion" || workflow === "all") {
      const result = await context.projectDb.execute(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM documents 
         WHERE project_id = ?`,
        [context.projectId]);
      const docStats = result[0] as any[];

      status.document_ingestion = {
        total: docStats[0]?.total || 0,
        completed: docStats[0]?.completed || 0,
        processing: docStats[0]?.processing || 0,
        failed: docStats[0]?.failed || 0,
        status: docStats[0]?.processing > 0 ? "in_progress" : "complete",
      };
    }

    // Check fact extraction workflow
    if (workflow === "fact_extraction" || workflow === "all") {
      const result = await context.projectDb.execute(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified,
          COUNT(DISTINCT category) as categories
         FROM extractedFacts 
         WHERE project_id = ?`,
        [context.projectId]);
      const factStats = result[0] as any[];

      const totalFacts = factStats[0]?.total || 0;
      const verifiedFacts = factStats[0]?.verified || 0;

      status.fact_extraction = {
        total: totalFacts,
        verified: verifiedFacts,
        unverified: totalFacts - verifiedFacts,
        categories: factStats[0]?.categories || 0,
        status: totalFacts === 0 ? "not_started" : verifiedFacts === totalFacts ? "complete" : "in_progress",
      };
    }

    // Check deliverables preparation
    if (workflow === "deliverables_prep" || workflow === "all") {
      const result = await context.projectDb.execute(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN mitigated = 1 THEN 1 ELSE 0 END) as mitigated
         FROM redFlags 
         WHERE project_id = ?`,
        [context.projectId]);
      const redFlagStats = result[0] as any[];

      const totalRedFlags = redFlagStats[0]?.total || 0;
      const mitigatedRedFlags = redFlagStats[0]?.mitigated || 0;

      status.deliverables_prep = {
        redFlags: {
          total: totalRedFlags,
          mitigated: mitigatedRedFlags,
          outstanding: totalRedFlags - mitigatedRedFlags,
        },
        status: totalRedFlags === 0 ? "not_started" : "in_progress",
      };
    }

    return {
      projectId: context.projectId,
      workflow,
      status,
      timestamp: new Date().toISOString(),
    };
  },
};

export const suggestNextActionsTool: ToolDefinition = {
  name: "suggest_next_actions",
  description: "Suggest the next recommended actions based on current project state and workflow progress.",
  parameters: {
    type: "object",
    properties: {
      priority: {
        type: "string",
        description: "Filter suggestions by priority",
        enum: ["high", "medium", "low", "all"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const priority = (args.priority as string) || "all";
    const suggestions: Array<{
      action: string;
      reason: string;
      priority: string;
      category: string;
    }> = [];

    // Check for documents that need processing
    const result1 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM documents 
       WHERE project_id = ? AND status IN ('uploaded', 'failed')`,
      [context.projectId]);
    const unprocessedDocs = result1[0] as any[];

    if (unprocessedDocs[0]?.count > 0) {
      suggestions.push({
        action: `Process ${unprocessedDocs[0].count} pending documents`,
        reason: "Documents are uploaded but not yet processed for fact extraction",
        priority: "high",
        category: "document_processing",
      });
    }

    // Check for unverified facts
    const result2 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM extractedFacts 
       WHERE project_id = ? AND verified = 0`,
      [context.projectId]);
    const unverifiedFacts = result2[0] as any[];

    if (unverifiedFacts[0]?.count > 0) {
      suggestions.push({
        action: `Verify ${unverifiedFacts[0].count} extracted facts`,
        reason: "Facts have been extracted but need verification for accuracy",
        priority: "medium",
        category: "fact_verification",
      });
    }

    // Check for high-severity red flags
    const result3 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM redFlags 
       WHERE project_id = ? AND severity IN ('critical', 'high') AND mitigated = 0`,
      [context.projectId]);
    const criticalRedFlags = result3[0] as any[];

    if (criticalRedFlags[0]?.count > 0) {
      suggestions.push({
        action: `Address ${criticalRedFlags[0].count} critical/high-severity red flags`,
        reason: "High-priority risks need mitigation strategies",
        priority: "high",
        category: "risk_mitigation",
      });
    }

    // Check if project has minimal data
    const result4 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM extractedFacts WHERE project_id = ?`,
      [context.projectId]);
    const factCount = result4[0] as any[];

    if (factCount[0]?.count < 10) {
      suggestions.push({
        action: "Upload more project documents",
        reason: "Project has limited data for comprehensive analysis",
        priority: "high",
        category: "data_collection",
      });
    }

    // Check for missing critical fact categories
    const result5 = await context.projectDb.execute(
      `SELECT DISTINCT category FROM extractedFacts WHERE project_id = ?`,
      [context.projectId]);
    const categories = result5[0] as any[];

    const existingCategories = categories.map((c: any) => c.category);
    const criticalCategories = ["technical", "financial", "location", "performance"];
    const missingCategories = criticalCategories.filter(
      (c) => !existingCategories.includes(c)
    );

    if (missingCategories.length > 0) {
      suggestions.push({
        action: `Extract facts for missing categories: ${missingCategories.join(", ")}`,
        reason: "Critical fact categories are missing for complete analysis",
        priority: "medium",
        category: "fact_extraction",
      });
    }

    // Filter by priority if specified
    const filteredSuggestions =
      priority === "all"
        ? suggestions
        : suggestions.filter((s) => s.priority === priority);

    return {
      projectId: context.projectId,
      suggestions: filteredSuggestions,
      totalSuggestions: filteredSuggestions.length,
      timestamp: new Date().toISOString(),
    };
  },
};

export const identifyMissingDataTool: ToolDefinition = {
  name: "identify_missing_data",
  description: "Identify missing or incomplete data sections that need attention.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Focus on a specific category",
        enum: ["technical", "financial", "location", "performance", "all"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const category = (args.category as string) || "all";
    const missingData: Array<{
      category: string;
      field: string;
      importance: string;
      suggestion: string;
    }> = [];

    // Define expected fields by category
    const expectedFields: Record<string, Array<{ field: string; importance: string }>> = {
      technical: [
        { field: "dc_capacity_mw", importance: "critical" },
        { field: "ac_capacity_mw", importance: "critical" },
        { field: "module_model", importance: "high" },
        { field: "inverter_model", importance: "high" },
        { field: "tracking_type", importance: "medium" },
      ],
      financial: [
        { field: "total_capex", importance: "critical" },
        { field: "total_opex", importance: "critical" },
        { field: "capex_per_watt", importance: "high" },
      ],
      location: [
        { field: "latitude", importance: "critical" },
        { field: "longitude", importance: "critical" },
        { field: "site_name", importance: "high" },
      ],
      performance: [
        { field: "p50_generation", importance: "critical" },
        { field: "capacity_factor", importance: "high" },
        { field: "specific_yield", importance: "high" },
      ],
    };

    // Check which categories to analyze
    const categoriesToCheck =
      category === "all" ? Object.keys(expectedFields) : [category];

    for (const cat of categoriesToCheck) {
      const fields = expectedFields[cat] || [];

      for (const { field, importance } of fields) {
        const queryResult = await context.projectDb.execute(
          `SELECT COUNT(*) as count FROM extractedFacts 
           WHERE project_id = ? AND category = ? AND \`key\` = ?`,
          [context.projectId, cat, field]);
        const result = queryResult[0] as any[];

        if (result[0]?.count === 0) {
          missingData.push({
            category: cat,
            field,
            importance,
            suggestion: `Extract or manually input ${field} from project documents`,
          });
        }
      }
    }

    // Sort by importance
    const importanceOrder: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
    missingData.sort(
      (a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]
    );

    return {
      projectId: context.projectId,
      category,
      missingData,
      totalMissing: missingData.length,
      criticalMissing: missingData.filter((d) => d.importance === "critical").length,
      timestamp: new Date().toISOString(),
    };
  },
};

export const validateProjectCompletenessTool: ToolDefinition = {
  name: "validate_project_completeness",
  description: "Validate if the project has sufficient data for generating deliverables and reports.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const validation: Record<string, any> = {
      overall: "incomplete",
      score: 0,
      maxScore: 100,
      checks: [],
    };

    // Check 1: Documents uploaded (20 points)
    const result1 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM documents WHERE project_id = ?`,
      [context.projectId]);
    const docCount = result1[0] as any[];
    const docs = docCount[0]?.count || 0;
    const docScore = Math.min(20, docs * 5);
    validation.checks.push({
      name: "Documents uploaded",
      status: docs > 0 ? "pass" : "fail",
      score: docScore,
      maxScore: 20,
      details: `${docs} documents uploaded`,
    });
    validation.score += docScore;

    // Check 2: Facts extracted (30 points)
    const result2 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM extractedFacts WHERE project_id = ?`,
      [context.projectId]);
    const factCount = result2[0] as any[];
    const facts = factCount[0]?.count || 0;
    const factScore = Math.min(30, facts * 2);
    validation.checks.push({
      name: "Facts extracted",
      status: facts >= 15 ? "pass" : "partial",
      score: factScore,
      maxScore: 30,
      details: `${facts} facts extracted (minimum 15 recommended)`,
    });
    validation.score += factScore;

    // Check 3: Critical categories present (25 points)
    const result3 = await context.projectDb.execute(
      `SELECT DISTINCT category FROM extractedFacts WHERE project_id = ?`,
      [context.projectId]);
    const categories = result3[0] as any[];
    const existingCategories = categories.map((c: any) => c.category);
    const criticalCategories = ["technical", "financial", "location"];
    const presentCategories = criticalCategories.filter((c) =>
      existingCategories.includes(c)
    );
    const categoryScore = (presentCategories.length / criticalCategories.length) * 25;
    validation.checks.push({
      name: "Critical categories present",
      status: presentCategories.length === criticalCategories.length ? "pass" : "partial",
      score: Math.round(categoryScore),
      maxScore: 25,
      details: `${presentCategories.length}/${criticalCategories.length} critical categories present`,
    });
    validation.score += Math.round(categoryScore);

    // Check 4: Red flags identified (15 points)
    const result4 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM redFlags WHERE project_id = ?`,
      [context.projectId]);
    const redFlagCount = result4[0] as any[];
    const redFlags = redFlagCount[0]?.count || 0;
    const redFlagScore = Math.min(15, redFlags * 5);
    validation.checks.push({
      name: "Red flags identified",
      status: redFlags > 0 ? "pass" : "warning",
      score: redFlagScore,
      maxScore: 15,
      details: `${redFlags} red flags identified`,
    });
    validation.score += redFlagScore;

    // Check 5: Facts verified (10 points)
    const result5 = await context.projectDb.execute(
      `SELECT COUNT(*) as count FROM extractedFacts WHERE project_id = ? AND verified = 1`,
      [context.projectId]);
    const verifiedCount = result5[0] as any[];
    const verified = verifiedCount[0]?.count || 0;
    const verificationRate = facts > 0 ? (verified / facts) * 10 : 0;
    validation.checks.push({
      name: "Facts verified",
      status: verificationRate >= 5 ? "pass" : "partial",
      score: Math.round(verificationRate),
      maxScore: 10,
      details: `${verified}/${facts} facts verified`,
    });
    validation.score += Math.round(verificationRate);

    // Determine overall status
    if (validation.score >= 80) {
      validation.overall = "complete";
    } else if (validation.score >= 50) {
      validation.overall = "partial";
    } else {
      validation.overall = "incomplete";
    }

    return {
      projectId: context.projectId,
      validation,
      readyForDeliverables: validation.score >= 70,
      timestamp: new Date().toISOString(),
    };
  },
};

// Export all workflow tools
export const workflowTools: ToolDefinition[] = [
  getWorkflowStatusTool,
  suggestNextActionsTool,
  identifyMissingDataTool,
  validateProjectCompletenessTool,
];
