import type { ToolDefinition } from "../tool-executor";

/**
 * Intelligence Tools
 * 
 * Smart analysis tools that go beyond simple data retrieval.
 * These tools cross-reference facts, validate against domain knowledge,
 * identify contradictions, and provide analytical insights.
 */

/**
 * Deep Dive Tool
 * 
 * Pulls ALL facts related to a topic across multiple categories,
 * including related red flags and document sources. This gives the
 * agent comprehensive context for analysis.
 */
export const deepDiveTool: ToolDefinition = {
  name: "deep_dive",
  description: "Perform a comprehensive deep dive on a topic by pulling ALL related facts across every category, plus related red flags and document sources. Use this when you need full context on a subject (e.g., 'grid connection', 'capacity', 'financial', 'land'). Returns facts grouped by category with source documents and related risks. This is your primary research tool — use it before providing detailed analysis.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The topic to deep dive into (e.g., 'capacity', 'grid', 'financial', 'land', 'environmental', 'technology', 'ownership')",
      },
      includeRelatedRisks: {
        type: "string",
        description: "Whether to also pull related risks/red flags (default: true)",
        enum: ["true", "false"],
      },
    },
    required: ["topic"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const topic = args.topic as string;
    const includeRisks = args.includeRelatedRisks !== "false";
    const tableName = `proj_${context.projectId}_extractedFacts`;

    // Search across ALL fields for the topic
    const factsQuery = `
      SELECT id, category, \`key\`, value, data_type, confidence, 
             source_document_id, extraction_method, verified, created_at
      FROM ${tableName}
      WHERE (
        value LIKE ? OR category LIKE ? OR \`key\` LIKE ?
      )
      ORDER BY category, confidence DESC
      LIMIT 100
    `;
    const searchTerm = `%${topic}%`;
    const factsResult = await context.projectDb.execute(factsQuery, [searchTerm, searchTerm, searchTerm]);
    const allFacts = factsResult[0] as any[];

    // Group facts by category
    const factsByCategory: Record<string, any[]> = {};
    for (const fact of allFacts) {
      if (!factsByCategory[fact.category]) {
        factsByCategory[fact.category] = [];
      }
      factsByCategory[fact.category].push(fact);
    }

    // Get related risks if requested
    let relatedRisks: any[] = [];
    if (includeRisks) {
      const risksQuery = `
        SELECT id, \`key\`, value, confidence, source_document_id, verified
        FROM ${tableName}
        WHERE category = 'Risks_And_Issues'
        AND (value LIKE ? OR \`key\` LIKE ?)
        ORDER BY confidence DESC
        LIMIT 20
      `;
      const risksResult = await context.projectDb.execute(risksQuery, [searchTerm, searchTerm]);
      relatedRisks = risksResult[0] as any[];
    }

    // Get unique source document IDs and fetch document info
    const sourceDocIds = new Set<number>();
    for (const fact of allFacts) {
      if (fact.source_document_id) sourceDocIds.add(fact.source_document_id);
    }
    for (const risk of relatedRisks) {
      if (risk.source_document_id) sourceDocIds.add(risk.source_document_id);
    }

    let sourceDocuments: any[] = [];
    if (sourceDocIds.size > 0) {
      const docTableName = `proj_${context.projectId}_documents`;
      const docIds = Array.from(sourceDocIds);
      const placeholders = docIds.map(() => '?').join(',');
      const docsQuery = `
        SELECT id, fileName, documentType
        FROM ${docTableName}
        WHERE id IN (${placeholders})
      `;
      try {
        const docsResult = await context.projectDb.execute(docsQuery, docIds);
        sourceDocuments = docsResult[0] as any[];
      } catch (e) {
        // Documents table might not exist or have different schema
        console.warn("[DEEP_DIVE] Could not fetch source documents:", e);
      }
    }

    // Calculate statistics
    const totalFacts = allFacts.length;
    const verifiedFacts = allFacts.filter(f => f.verified).length;
    const avgConfidence = totalFacts > 0
      ? allFacts.reduce((sum, f) => sum + (parseFloat(f.confidence) || 0), 0) / totalFacts
      : 0;

    return {
      topic,
      summary: {
        totalFacts,
        verifiedFacts,
        unverifiedFacts: totalFacts - verifiedFacts,
        averageConfidence: Math.round(avgConfidence * 100) / 100,
        categoriesFound: Object.keys(factsByCategory),
        relatedRisksCount: relatedRisks.length,
        sourceDocumentsCount: sourceDocuments.length,
      },
      factsByCategory,
      relatedRisks,
      sourceDocuments,
    };
  },
};

/**
 * Cross-Reference Facts Tool
 * 
 * Finds facts that relate to each other and identifies potential
 * contradictions or inconsistencies between them.
 */
export const crossReferenceTool: ToolDefinition = {
  name: "cross_reference_facts",
  description: "Cross-reference facts across categories to find relationships, contradictions, and inconsistencies. Compares facts from different sources and categories that relate to the same topic. Use this when you need to verify data consistency or when facts seem contradictory.",
  parameters: {
    type: "object",
    properties: {
      factIds: {
        type: "string",
        description: "Comma-separated list of fact IDs to cross-reference against each other",
      },
      topic: {
        type: "string",
        description: "Topic to cross-reference across all categories (alternative to factIds)",
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    let facts: any[] = [];

    if (args.factIds) {
      const ids = (args.factIds as string).split(',').map(id => id.trim());
      const placeholders = ids.map(() => '?').join(',');
      const query = `
        SELECT id, category, \`key\`, value, data_type, confidence, 
               source_document_id, extraction_method, verified
        FROM ${tableName}
        WHERE id IN (${placeholders})
      `;
      const result = await context.projectDb.execute(query, ids);
      facts = result[0] as any[];
    } else if (args.topic) {
      const searchTerm = `%${args.topic}%`;
      const query = `
        SELECT id, category, \`key\`, value, data_type, confidence, 
               source_document_id, extraction_method, verified
        FROM ${tableName}
        WHERE (value LIKE ? OR \`key\` LIKE ?)
        ORDER BY category, \`key\`
        LIMIT 50
      `;
      const result = await context.projectDb.execute(query, [searchTerm, searchTerm]);
      facts = result[0] as any[];
    } else {
      throw new Error("Either factIds or topic must be provided");
    }

    // Group by key to find potential duplicates/contradictions
    const factsByKey: Record<string, any[]> = {};
    for (const fact of facts) {
      const normalizedKey = fact.key.toLowerCase().replace(/[_\s-]+/g, '_');
      if (!factsByKey[normalizedKey]) {
        factsByKey[normalizedKey] = [];
      }
      factsByKey[normalizedKey].push(fact);
    }

    // Identify potential contradictions (same key, different values from different sources)
    const contradictions: any[] = [];
    const agreements: any[] = [];
    
    for (const [key, keyFacts] of Object.entries(factsByKey)) {
      if (keyFacts.length > 1) {
        const uniqueValues = new Set(keyFacts.map(f => f.value?.toString().trim().toLowerCase()));
        if (uniqueValues.size > 1) {
          contradictions.push({
            key,
            facts: keyFacts.map(f => ({
              id: f.id,
              category: f.category,
              value: f.value,
              confidence: f.confidence,
              sourceDocumentId: f.source_document_id,
              verified: f.verified,
            })),
            issue: `Multiple different values found for "${key}"`,
          });
        } else {
          agreements.push({
            key,
            value: keyFacts[0].value,
            confirmedBy: keyFacts.length,
            sources: keyFacts.map(f => f.source_document_id).filter(Boolean),
          });
        }
      }
    }

    // Check for facts from different sources
    const sourceGroups: Record<number, any[]> = {};
    for (const fact of facts) {
      if (fact.source_document_id) {
        if (!sourceGroups[fact.source_document_id]) {
          sourceGroups[fact.source_document_id] = [];
        }
        sourceGroups[fact.source_document_id].push(fact);
      }
    }

    return {
      totalFactsAnalyzed: facts.length,
      contradictions: {
        count: contradictions.length,
        items: contradictions,
      },
      agreements: {
        count: agreements.length,
        items: agreements,
      },
      sourceDistribution: Object.entries(sourceGroups).map(([docId, docFacts]) => ({
        documentId: parseInt(docId),
        factCount: docFacts.length,
      })),
      allFacts: facts,
    };
  },
};

/**
 * Validate Project Metrics Tool
 * 
 * Checks key project metrics against industry benchmarks and flags
 * values that are outside expected ranges.
 */
export const validateMetricsTool: ToolDefinition = {
  name: "validate_project_metrics",
  description: "Validate key project metrics against industry benchmarks for solar PV projects. Checks DC/AC ratio, capacity factor, power density, CAPEX, performance ratio, and other critical metrics. Returns a list of findings with severity levels (ok, warning, critical). Use this to quickly assess data quality and flag items needing verification.",
  parameters: {
    type: "object",
    properties: {
      focusArea: {
        type: "string",
        description: "Focus validation on a specific area (default: all)",
        enum: ["all", "capacity", "financial", "performance", "grid", "land"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    const focusArea = (args.focusArea as string) || "all";

    // Pull all facts for validation
    const query = `
      SELECT id, category, \`key\`, value, data_type, confidence, verified
      FROM ${tableName}
      ORDER BY category, \`key\`
    `;
    const result = await context.projectDb.execute(query);
    const allFacts = result[0] as any[];

    // Build a lookup map for quick access
    const factLookup: Record<string, any[]> = {};
    for (const fact of allFacts) {
      const normalizedKey = fact.key.toLowerCase().replace(/[_\s-]+/g, '_');
      if (!factLookup[normalizedKey]) {
        factLookup[normalizedKey] = [];
      }
      factLookup[normalizedKey].push(fact);
    }

    // Also build a value search function
    const findFactByKeyword = (keyword: string): any[] => {
      return allFacts.filter(f => 
        f.key.toLowerCase().includes(keyword.toLowerCase()) ||
        f.value?.toString().toLowerCase().includes(keyword.toLowerCase())
      );
    };

    const findings: Array<{
      metric: string;
      value: string;
      benchmark: string;
      status: string; // ok, warning, critical, missing
      explanation: string;
      factId?: number;
    }> = [];

    // Helper to extract numeric value from a fact
    const extractNumber = (value: string): number | null => {
      if (!value) return null;
      const match = value.toString().match(/[\d,]+\.?\d*/);
      if (match) return parseFloat(match[0].replace(/,/g, ''));
      return null;
    };

    // === CAPACITY VALIDATION ===
    if (focusArea === "all" || focusArea === "capacity") {
      const dcFacts = findFactByKeyword("dc_capacity").concat(findFactByKeyword("dc capacity"));
      const acFacts = findFactByKeyword("ac_capacity").concat(findFactByKeyword("ac capacity"));

      let dcCapacity: number | null = null;
      let acCapacity: number | null = null;

      for (const f of dcFacts) {
        const val = extractNumber(f.value);
        if (val && val > 0) { dcCapacity = val; break; }
      }
      for (const f of acFacts) {
        const val = extractNumber(f.value);
        if (val && val > 0) { acCapacity = val; break; }
      }

      if (dcCapacity && acCapacity) {
        const dcAcRatio = dcCapacity / acCapacity;
        let status = "ok";
        let explanation = `DC/AC ratio of ${dcAcRatio.toFixed(2)} is within the typical range of 1.15-1.40.`;

        if (dcAcRatio < 1.0) {
          status = "critical";
          explanation = `DC/AC ratio of ${dcAcRatio.toFixed(2)} is below 1.0, which is physically unusual. This likely indicates a data error — DC capacity should always exceed AC capacity.`;
        } else if (dcAcRatio < 1.10) {
          status = "warning";
          explanation = `DC/AC ratio of ${dcAcRatio.toFixed(2)} is below the typical range of 1.15-1.40. This is very conservative and may indicate under-sizing of the DC array or a data entry issue.`;
        } else if (dcAcRatio > 1.50) {
          status = "warning";
          explanation = `DC/AC ratio of ${dcAcRatio.toFixed(2)} exceeds the typical range of 1.15-1.40. This is aggressive and may lead to significant clipping losses.`;
        }

        findings.push({
          metric: "DC/AC Ratio",
          value: dcAcRatio.toFixed(2),
          benchmark: "1.15 – 1.40",
          status,
          explanation,
        });
      } else {
        if (!dcCapacity) {
          findings.push({
            metric: "DC Capacity",
            value: "Not found",
            benchmark: "Required",
            status: "missing",
            explanation: "DC capacity is a critical metric that should be present in project documentation. Check technical design documents or the PPA.",
          });
        }
        if (!acCapacity) {
          findings.push({
            metric: "AC Capacity",
            value: "Not found",
            benchmark: "Required",
            status: "missing",
            explanation: "AC capacity is a critical metric needed for grid connection assessment and DC/AC ratio validation.",
          });
        }
      }
    }

    // === LAND / POWER DENSITY VALIDATION ===
    if (focusArea === "all" || focusArea === "land" || focusArea === "capacity") {
      const areaFacts = findFactByKeyword("area").concat(findFactByKeyword("hectare")).concat(findFactByKeyword("land"));
      const dcFacts = findFactByKeyword("dc_capacity").concat(findFactByKeyword("dc capacity"));

      let area: number | null = null;
      let dcCapacity: number | null = null;

      for (const f of areaFacts) {
        const val = extractNumber(f.value);
        if (val && val > 1) { area = val; break; }
      }
      for (const f of dcFacts) {
        const val = extractNumber(f.value);
        if (val && val > 0) { dcCapacity = val; break; }
      }

      if (area && dcCapacity) {
        const powerDensity = dcCapacity / area;
        let status = "ok";
        let explanation = `Power density of ${powerDensity.toFixed(2)} MW/ha is within the typical range for utility-scale solar.`;

        if (powerDensity < 0.4) {
          status = "warning";
          explanation = `Power density of ${powerDensity.toFixed(2)} MW/ha is unusually low. This may indicate the area includes non-usable land, or the capacity figure needs verification.`;
        } else if (powerDensity > 1.5) {
          status = "warning";
          explanation = `Power density of ${powerDensity.toFixed(2)} MW/ha is unusually high. Typical range is 0.6-1.2 MW/ha depending on tracking type. Verify the area and capacity figures.`;
        }

        findings.push({
          metric: "Power Density",
          value: `${powerDensity.toFixed(2)} MW/ha`,
          benchmark: "0.6 – 1.2 MW/ha",
          status,
          explanation,
        });
      }
    }

    // === PERFORMANCE VALIDATION ===
    if (focusArea === "all" || focusArea === "performance") {
      const cfFacts = findFactByKeyword("capacity_factor").concat(findFactByKeyword("capacity factor"));
      const prFacts = findFactByKeyword("performance_ratio").concat(findFactByKeyword("performance ratio"));
      const yieldFacts = findFactByKeyword("specific_yield").concat(findFactByKeyword("yield")).concat(findFactByKeyword("generation"));
      const degradationFacts = findFactByKeyword("degradation");

      for (const f of cfFacts) {
        const val = extractNumber(f.value);
        if (val) {
          const cfPercent = val > 1 ? val : val * 100; // Handle both 0.25 and 25%
          let status = "ok";
          let explanation = `Capacity factor of ${cfPercent.toFixed(1)}% is within the expected range for this region.`;

          if (cfPercent < 15) {
            status = "critical";
            explanation = `Capacity factor of ${cfPercent.toFixed(1)}% is very low, even for northern European locations. This needs immediate verification.`;
          } else if (cfPercent < 20) {
            status = "warning";
            explanation = `Capacity factor of ${cfPercent.toFixed(1)}% is below the typical MENA range of 22-26%. If this is a MENA project, verify the solar resource assessment.`;
          } else if (cfPercent > 30) {
            status = "warning";
            explanation = `Capacity factor of ${cfPercent.toFixed(1)}% is unusually high for solar PV. Verify this isn't a hybrid plant or that the calculation methodology is correct.`;
          }

          findings.push({
            metric: "Capacity Factor",
            value: `${cfPercent.toFixed(1)}%`,
            benchmark: "20% – 28% (MENA)",
            status,
            explanation,
            factId: f.id,
          });
          break;
        }
      }

      for (const f of degradationFacts) {
        const val = extractNumber(f.value);
        if (val) {
          const deg = val > 1 ? val : val * 100;
          let status = "ok";
          let explanation = `Module degradation of ${deg.toFixed(2)}%/year is within the typical range.`;

          if (deg > 1.0) {
            status = "warning";
            explanation = `Module degradation of ${deg.toFixed(2)}%/year exceeds the typical range of 0.4-0.7%. This may significantly impact long-term yield.`;
          } else if (deg < 0.3) {
            status = "warning";
            explanation = `Module degradation of ${deg.toFixed(2)}%/year is unusually low. Verify this is supported by the module manufacturer's warranty.`;
          }

          findings.push({
            metric: "Module Degradation",
            value: `${deg.toFixed(2)}%/year`,
            benchmark: "0.4% – 0.7%/year",
            status,
            explanation,
            factId: f.id,
          });
          break;
        }
      }
    }

    // === DATA QUALITY OVERVIEW ===
    const totalFacts = allFacts.length;
    const verifiedCount = allFacts.filter(f => f.verified).length;
    const highConfidenceCount = allFacts.filter(f => parseFloat(f.confidence) >= 0.8).length;
    const lowConfidenceCount = allFacts.filter(f => parseFloat(f.confidence) < 0.5).length;

    // Identify categories with no data
    const existingCategories = new Set(allFacts.map(f => f.category));
    const expectedCategories = [
      "Project_Overview", "Design_Parameters", "Technical_Design",
      "Financial", "Location", "Performance", "Dependencies",
      "Risks_And_Issues", "Engineering_Assumptions", "Specifications"
    ];
    const missingCategories = expectedCategories.filter(c => !existingCategories.has(c));

    return {
      focusArea,
      findings,
      summary: {
        totalFindings: findings.length,
        critical: findings.filter(f => f.status === "critical").length,
        warnings: findings.filter(f => f.status === "warning").length,
        ok: findings.filter(f => f.status === "ok").length,
        missing: findings.filter(f => f.status === "missing").length,
      },
      dataQuality: {
        totalFacts,
        verifiedFacts: verifiedCount,
        verificationRate: totalFacts > 0 ? `${Math.round(verifiedCount / totalFacts * 100)}%` : "N/A",
        highConfidenceFacts: highConfidenceCount,
        lowConfidenceFacts: lowConfidenceCount,
        missingCategories,
      },
    };
  },
};

/**
 * Fact Lineage Tool
 * 
 * Traces a fact back to its source document and shows related facts
 * from the same source, helping users understand provenance.
 */
export const factLineageTool: ToolDefinition = {
  name: "trace_fact_lineage",
  description: "Trace a fact back to its source document and show all other facts extracted from the same source. Use this to understand data provenance, verify source reliability, and see what else was extracted from the same document.",
  parameters: {
    type: "object",
    properties: {
      factId: {
        type: "string",
        description: "The ID of the fact to trace",
      },
    },
    required: ["factId"],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;

    // Get the target fact
    const factQuery = `
      SELECT id, category, \`key\`, value, data_type, confidence, 
             source_document_id, extraction_method, verified, created_at
      FROM ${tableName}
      WHERE id = ?
    `;
    const factResult = await context.projectDb.execute(factQuery, [args.factId]);
    const facts = factResult[0] as any[];

    if (facts.length === 0) {
      return { error: "Fact not found", factId: args.factId };
    }

    const targetFact = facts[0];

    // Get source document info
    let sourceDocument = null;
    let siblingFacts: any[] = [];

    if (targetFact.source_document_id) {
      try {
        const docTableName = `proj_${context.projectId}_documents`;
        const docQuery = `
          SELECT id, fileName, documentType, pageCount, status
          FROM ${docTableName}
          WHERE id = ?
        `;
        const docResult = await context.projectDb.execute(docQuery, [targetFact.source_document_id]);
        const docs = docResult[0] as any[];
        if (docs.length > 0) {
          sourceDocument = docs[0];
        }
      } catch (e) {
        console.warn("[LINEAGE] Could not fetch source document:", e);
      }

      // Get all facts from the same source document
      const siblingsQuery = `
        SELECT id, category, \`key\`, value, confidence, verified
        FROM ${tableName}
        WHERE source_document_id = ? AND id != ?
        ORDER BY category, \`key\`
        LIMIT 50
      `;
      const siblingsResult = await context.projectDb.execute(siblingsQuery, [targetFact.source_document_id, args.factId]);
      siblingFacts = siblingsResult[0] as any[];
    }

    // Group sibling facts by category
    const siblingsByCategory: Record<string, any[]> = {};
    for (const fact of siblingFacts) {
      if (!siblingsByCategory[fact.category]) {
        siblingsByCategory[fact.category] = [];
      }
      siblingsByCategory[fact.category].push(fact);
    }

    return {
      targetFact,
      sourceDocument,
      siblingFacts: {
        total: siblingFacts.length,
        byCategory: siblingsByCategory,
      },
      provenance: {
        extractionMethod: targetFact.extraction_method,
        confidence: targetFact.confidence,
        verified: targetFact.verified,
        sourceDocumentId: targetFact.source_document_id,
        sourceFileName: sourceDocument?.fileName || "Unknown",
        sourceDocumentType: sourceDocument?.documentType || "Unknown",
      },
    };
  },
};

/**
 * Completeness Assessment Tool
 * 
 * Assesses how complete the project data is for due diligence purposes,
 * identifying specific gaps that need to be filled.
 */
export const completenessAssessmentTool: ToolDefinition = {
  name: "assess_completeness",
  description: "Assess the completeness of project data for due diligence purposes. Checks for critical missing information across all key areas (technical, financial, legal, environmental, grid) and provides a completeness score with specific recommendations for what data is still needed. Use this to guide data collection efforts.",
  parameters: {
    type: "object",
    properties: {
      ddType: {
        type: "string",
        description: "Type of due diligence assessment (affects which fields are considered critical)",
        enum: ["technical", "financial", "legal", "environmental", "full"],
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    if (!context.projectDb) {
      throw new Error("Project database not available");
    }

    const tableName = `proj_${context.projectId}_extractedFacts`;
    const ddType = (args.ddType as string) || "full";

    // Get all facts
    const query = `
      SELECT category, \`key\`, value, confidence, verified
      FROM ${tableName}
      ORDER BY category
    `;
    const result = await context.projectDb.execute(query);
    const allFacts = result[0] as any[];

    // Build lookup
    const factKeys = new Set(allFacts.map(f => f.key.toLowerCase().replace(/[_\s-]+/g, '_')));
    const factCategories = new Set(allFacts.map(f => f.category));

    // Define what's needed for each DD type
    const ddRequirements: Record<string, Array<{
      area: string;
      items: Array<{ key: string; keywords: string[]; importance: string; description: string }>;
    }>> = {
      technical: [
        {
          area: "Project Capacity & Design",
          items: [
            { key: "dc_capacity", keywords: ["dc_capacity", "dc capacity", "mwp"], importance: "critical", description: "DC nameplate capacity in MWp" },
            { key: "ac_capacity", keywords: ["ac_capacity", "ac capacity", "mwac", "mw"], importance: "critical", description: "AC export capacity in MW" },
            { key: "module_type", keywords: ["module", "panel", "pv module"], importance: "high", description: "PV module manufacturer and model" },
            { key: "inverter_type", keywords: ["inverter"], importance: "high", description: "Inverter manufacturer and model" },
            { key: "tracking", keywords: ["tracking", "tracker", "fixed tilt"], importance: "high", description: "Tracking system type (fixed/SAT/DAT)" },
            { key: "dc_ac_ratio", keywords: ["dc/ac", "dc_ac", "oversize"], importance: "medium", description: "DC/AC ratio (can be calculated if both capacities known)" },
          ],
        },
        {
          area: "Site & Location",
          items: [
            { key: "location", keywords: ["location", "site", "country", "region"], importance: "critical", description: "Project location and country" },
            { key: "area", keywords: ["area", "hectare", "acre", "land"], importance: "high", description: "Total site area" },
            { key: "coordinates", keywords: ["latitude", "longitude", "coordinate", "gps"], importance: "medium", description: "Site coordinates" },
            { key: "topography", keywords: ["topography", "terrain", "slope", "elevation"], importance: "medium", description: "Site topography and terrain" },
          ],
        },
        {
          area: "Grid Connection",
          items: [
            { key: "grid_voltage", keywords: ["kv", "voltage", "grid", "transmission"], importance: "critical", description: "Grid connection voltage level" },
            { key: "grid_distance", keywords: ["grid distance", "transmission line", "substation"], importance: "high", description: "Distance to grid connection point" },
            { key: "grid_operator", keywords: ["grid operator", "transmission", "oetc", "utility"], importance: "medium", description: "Grid operator / transmission company" },
          ],
        },
        {
          area: "Performance",
          items: [
            { key: "capacity_factor", keywords: ["capacity factor", "cf"], importance: "high", description: "Expected capacity factor" },
            { key: "specific_yield", keywords: ["specific yield", "kwh/kwp", "yield"], importance: "high", description: "Specific yield (kWh/kWp)" },
            { key: "performance_ratio", keywords: ["performance ratio", "pr"], importance: "medium", description: "Performance ratio" },
            { key: "annual_generation", keywords: ["annual generation", "gwh", "energy yield", "p50"], importance: "high", description: "Expected annual generation (P50)" },
          ],
        },
      ],
      financial: [
        {
          area: "Capital Expenditure",
          items: [
            { key: "total_capex", keywords: ["capex", "capital expenditure", "total cost", "investment"], importance: "critical", description: "Total project CAPEX" },
            { key: "capex_per_wp", keywords: ["$/wp", "cost per watt", "capex/wp"], importance: "high", description: "CAPEX per watt-peak" },
            { key: "epc_cost", keywords: ["epc", "construction cost"], importance: "high", description: "EPC contract value" },
          ],
        },
        {
          area: "Revenue & Offtake",
          items: [
            { key: "ppa_price", keywords: ["ppa", "tariff", "price", "offtake"], importance: "critical", description: "PPA price / tariff" },
            { key: "ppa_term", keywords: ["ppa term", "contract duration", "years"], importance: "critical", description: "PPA contract duration" },
            { key: "offtaker", keywords: ["offtaker", "buyer", "utility"], importance: "high", description: "Power offtaker / buyer" },
          ],
        },
        {
          area: "Financing",
          items: [
            { key: "debt_equity", keywords: ["debt", "equity", "leverage", "gearing"], importance: "high", description: "Debt/equity ratio" },
            { key: "irr", keywords: ["irr", "return", "yield"], importance: "high", description: "Expected IRR" },
            { key: "dscr", keywords: ["dscr", "debt service"], importance: "medium", description: "Debt service coverage ratio" },
          ],
        },
        {
          area: "Ownership",
          items: [
            { key: "ownership", keywords: ["ownership", "shareholder", "sponsor", "spv"], importance: "critical", description: "Project ownership structure" },
            { key: "developer", keywords: ["developer", "sponsor"], importance: "high", description: "Project developer" },
          ],
        },
      ],
      environmental: [
        {
          area: "Environmental Assessment",
          items: [
            { key: "esia", keywords: ["esia", "eia", "environmental impact", "environmental assessment"], importance: "critical", description: "Environmental and Social Impact Assessment" },
            { key: "biodiversity", keywords: ["biodiversity", "flora", "fauna", "species"], importance: "high", description: "Biodiversity assessment" },
            { key: "water", keywords: ["water", "hydrology", "flood"], importance: "medium", description: "Water resources and flood risk" },
          ],
        },
        {
          area: "Permits & Approvals",
          items: [
            { key: "land_permit", keywords: ["land permit", "land approval", "land lease", "land allocation"], importance: "critical", description: "Land use permit / lease" },
            { key: "construction_permit", keywords: ["construction permit", "building permit"], importance: "critical", description: "Construction permit" },
            { key: "grid_permit", keywords: ["grid permit", "connection agreement", "grid approval"], importance: "high", description: "Grid connection permit" },
          ],
        },
      ],
      legal: [
        {
          area: "Contracts",
          items: [
            { key: "ppa_contract", keywords: ["ppa", "power purchase", "offtake agreement"], importance: "critical", description: "Power Purchase Agreement" },
            { key: "epc_contract", keywords: ["epc contract", "construction contract"], importance: "critical", description: "EPC Contract" },
            { key: "om_contract", keywords: ["o&m", "operation", "maintenance"], importance: "high", description: "O&M Contract" },
            { key: "land_lease", keywords: ["land lease", "land agreement", "land right"], importance: "critical", description: "Land lease / rights agreement" },
          ],
        },
      ],
    };

    // Determine which requirements to check
    let requirementsToCheck: typeof ddRequirements.technical = [];
    if (ddType === "full") {
      for (const reqs of Object.values(ddRequirements)) {
        requirementsToCheck.push(...reqs);
      }
    } else if (ddRequirements[ddType]) {
      requirementsToCheck = ddRequirements[ddType];
    }

    // Check each requirement
    const assessment: Array<{
      area: string;
      items: Array<{
        key: string;
        description: string;
        importance: string;
        status: string; // found, partial, missing
        matchedFacts: any[];
      }>;
      completeness: number;
    }> = [];

    let totalItems = 0;
    let foundItems = 0;

    for (const area of requirementsToCheck) {
      const areaItems: typeof assessment[0]["items"] = [];
      let areaFound = 0;

      for (const item of area.items) {
        totalItems++;
        // Check if any fact matches the keywords
        const matchedFacts = allFacts.filter(f => {
          const keyLower = f.key.toLowerCase();
          const valueLower = (f.value || '').toString().toLowerCase();
          return item.keywords.some(kw => 
            keyLower.includes(kw.toLowerCase()) || valueLower.includes(kw.toLowerCase())
          );
        });

        const status = matchedFacts.length > 0 ? "found" : "missing";
        if (status === "found") {
          foundItems++;
          areaFound++;
        }

        areaItems.push({
          key: item.key,
          description: item.description,
          importance: item.importance,
          status,
          matchedFacts: matchedFacts.slice(0, 3).map(f => ({
            id: f.id,
            key: f.key,
            value: f.value?.toString().substring(0, 200),
            confidence: f.confidence,
            verified: f.verified,
          })),
        });
      }

      assessment.push({
        area: area.area,
        items: areaItems,
        completeness: area.items.length > 0 ? Math.round(areaFound / area.items.length * 100) : 0,
      });
    }

    const overallCompleteness = totalItems > 0 ? Math.round(foundItems / totalItems * 100) : 0;

    // Identify critical gaps
    const criticalGaps = assessment.flatMap(a => 
      a.items.filter(i => i.status === "missing" && i.importance === "critical")
    );

    return {
      ddType,
      overallCompleteness: `${overallCompleteness}%`,
      totalItems,
      foundItems,
      missingItems: totalItems - foundItems,
      criticalGaps: {
        count: criticalGaps.length,
        items: criticalGaps.map(g => ({
          key: g.key,
          description: g.description,
          suggestion: `Look for this in technical design documents, project information memorandums, or financial models.`,
        })),
      },
      assessment,
      recommendation: overallCompleteness >= 80
        ? "Data completeness is good. Focus on verifying existing facts and addressing any critical gaps."
        : overallCompleteness >= 50
        ? "Data is partially complete. Several important areas need additional information. Prioritize critical gaps."
        : "Data is significantly incomplete. Major data collection effort needed before a comprehensive due diligence assessment can be performed.",
    };
  },
};

// Export all intelligence tools
export const intelligenceTools: ToolDefinition[] = [
  deepDiveTool,
  crossReferenceTool,
  validateMetricsTool,
  factLineageTool,
  completenessAssessmentTool,
];
