import { v4 as uuidv4 } from "uuid";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { agentKnowledgeBase } from "./schema";

/**
 * Seed Knowledge Base
 * 
 * Populates the agentKnowledgeBase table with foundational solar PV
 * due diligence knowledge. This gives the agent a strong starting point
 * before it begins learning from actual project interactions.
 * 
 * Run this once during initial deployment. The agent will continue
 * to build on this foundation through auto-extraction.
 * 
 * Usage:
 *   import { seedKnowledgeBase } from './seed-knowledge-base';
 *   await seedKnowledgeBase(db);
 */

interface SeedEntry {
  category: string;
  topic: string;
  content: string;
  confidence: string;
  tags: string[];
  applicability: string[];
  relatedTopics: string[];
}

const SEED_DATA: SeedEntry[] = [
  // ============================================================
  // BENCHMARKS
  // ============================================================
  {
    category: "benchmark",
    topic: "Solar PV DC/AC Ratio Industry Standards",
    content: "The DC/AC ratio (also called inverter loading ratio or ILR) for utility-scale solar PV typically ranges from 1.15 to 1.40. Values below 1.10 indicate conservative/underloaded design that may not optimize inverter utilization. Values above 1.50 are aggressive and increase clipping losses. The optimal ratio depends on the tariff structure (flat vs time-of-use), irradiance profile, and inverter cost. In high-irradiance regions like MENA, ratios of 1.25-1.35 are common for single-axis tracker systems. For fixed-tilt systems, slightly lower ratios (1.15-1.25) are typical.",
    confidence: "high",
    tags: ["dc_ac_ratio", "inverter", "design", "clipping"],
    applicability: ["solar", "utility-scale"],
    relatedTopics: ["inverter sizing", "clipping losses", "energy yield"],
  },
  {
    category: "benchmark",
    topic: "Solar Capacity Factor by Region",
    content: "Expected capacity factors for utility-scale solar PV vary significantly by region. MENA region: 22-28% (with tracking), 18-22% (fixed tilt). Oman specifically: 22-26%. UAE: 23-27%. Saudi Arabia: 22-27%. Southern Europe (Spain, Italy, Greece): 15-20%. Northern Europe: 10-14%. India: 17-23%. Australia: 20-27%. USA Southwest: 22-28%. Chile (Atacama): 25-32%. Values significantly outside these ranges warrant verification of the energy yield assessment methodology.",
    confidence: "high",
    tags: ["capacity_factor", "energy_yield", "regional"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["irradiance", "specific yield", "performance ratio"],
  },
  {
    category: "benchmark",
    topic: "Solar PV CAPEX Ranges by Region and Year",
    content: "Utility-scale solar PV CAPEX (2024-2025 estimates): Global average $0.50-$1.00/Wp. MENA region: $0.45-$0.75/Wp (lower labor costs, established supply chains). Europe: $0.60-$1.00/Wp. USA: $0.80-$1.20/Wp (higher due to tariffs and labor). India: $0.35-$0.55/Wp. CAPEX includes modules, inverters, BOS, EPC, and development costs but excludes land and grid connection. Module prices have declined significantly but supply chain disruptions and trade tariffs can cause regional variations. CAPEX below $0.35/Wp or above $1.50/Wp for utility-scale should be verified.",
    confidence: "high",
    tags: ["capex", "cost", "investment", "pricing"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["module pricing", "EPC costs", "BOS costs"],
  },
  {
    category: "benchmark",
    topic: "Solar PV Power Density Standards",
    content: "Power density (MW per hectare) varies by technology and tracking: Fixed-tilt systems: 0.8-1.2 MWp/ha. Single-axis tracker (SAT): 0.6-1.0 MWp/ha (requires more spacing for backtracking). Dual-axis tracker: 0.4-0.7 MWp/ha. Bifacial modules with SAT may require slightly wider spacing (0.5-0.8 MWp/ha) to optimize bifacial gain. Power density below 0.5 MWp/ha suggests either very conservative layout, significant unusable area, or dual-axis tracking. Power density above 1.3 MWp/ha suggests very dense layout that may cause inter-row shading.",
    confidence: "high",
    tags: ["power_density", "land_use", "layout", "tracking"],
    applicability: ["solar", "utility-scale"],
    relatedTopics: ["site area", "tracking system", "inter-row spacing"],
  },
  {
    category: "benchmark",
    topic: "Solar Module Degradation Rates",
    content: "Annual degradation rates for crystalline silicon PV modules: Standard mono-PERC: 0.40-0.55%/year. High-efficiency HJT/TOPCon: 0.35-0.50%/year. Bifacial modules: 0.40-0.55%/year (front side). First-year degradation (LID/LeTID): typically 1.5-3.0% for standard modules, 0.5-1.5% for n-type. Manufacturer warranties typically guarantee 84-87% of nameplate at year 25. Degradation above 0.7%/year in financial models is conservative; below 0.3%/year may be optimistic unless using premium n-type technology.",
    confidence: "high",
    tags: ["degradation", "module", "performance", "warranty"],
    applicability: ["solar", "utility-scale"],
    relatedTopics: ["module technology", "energy yield", "financial model"],
  },
  {
    category: "benchmark",
    topic: "Performance Ratio Benchmarks for Solar PV",
    content: "Performance Ratio (PR) for utility-scale solar PV: New systems with modern technology: 80-85%. Systems after 1 year (including degradation): 78-83%. Lifetime average PR: 75-80%. PR components: Temperature losses (5-15% depending on climate), soiling (1-5%), mismatch (1-2%), wiring losses (1-2%), inverter efficiency (1-3%), transformer losses (0.5-1.5%), availability (0.5-3%). In hot climates like MENA, temperature losses are higher (10-15%), but this is partially offset by lower soiling in desert environments. PR below 72% or above 88% in financial models should be questioned.",
    confidence: "high",
    tags: ["performance_ratio", "losses", "efficiency"],
    applicability: ["solar", "utility-scale"],
    relatedTopics: ["energy yield", "temperature coefficient", "soiling"],
  },
  // ============================================================
  // BEST PRACTICES
  // ============================================================
  {
    category: "best_practice",
    topic: "Due Diligence Data Completeness Requirements",
    content: "A comprehensive technical due diligence for solar PV should cover: (1) Site assessment — location, area, topography, geotechnical, access roads, flood risk. (2) Resource assessment — irradiance data (satellite + ground), P50/P75/P90 estimates, uncertainty analysis. (3) Technology — module specs, inverter specs, tracker specs, BOS design. (4) Energy yield — independent assessment, loss assumptions, degradation model. (5) Grid connection — voltage level, distance, connection agreement, curtailment risk. (6) Environmental — ESIA, biodiversity, water, cultural heritage. (7) Permitting — land rights, construction permits, generation license, grid permit. (8) Contracts — PPA, EPC, O&M, land lease, insurance. (9) Financial — CAPEX breakdown, OPEX assumptions, revenue model, debt terms. Missing any of these areas represents a material gap in due diligence.",
    confidence: "high",
    tags: ["due_diligence", "completeness", "checklist"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["technical DD", "financial DD", "legal DD"],
  },
  {
    category: "best_practice",
    topic: "Red Flag Identification in Solar Project DD",
    content: "Key red flags to watch for in solar PV due diligence: (1) DC/AC ratio outside 1.10-1.45 range. (2) Capacity factor significantly above regional norms (may indicate optimistic yield). (3) CAPEX significantly below market (may indicate scope exclusions or quality concerns). (4) No independent energy yield assessment. (5) Single-source irradiance data without validation. (6) Missing or incomplete ESIA. (7) Land rights not secured or under dispute. (8) Grid connection agreement not executed. (9) PPA not signed or key terms still under negotiation. (10) EPC contractor without track record in the region. (11) No O&M plan or budget. (12) Degradation assumptions below manufacturer warranty curve. (13) Availability assumption above 99% without justification. (14) No curtailment risk assessment.",
    confidence: "high",
    tags: ["red_flags", "risk", "due_diligence"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["risk assessment", "investment decision", "bankability"],
  },
  {
    category: "best_practice",
    topic: "Energy Yield Assessment Best Practices",
    content: "A bankable energy yield assessment should include: (1) Minimum 2 satellite irradiance datasets (e.g., Meteonorm, SolarGIS, Solcast) with cross-validation. (2) Ground measurement data if available (minimum 1 year, ideally correlated with long-term satellite data). (3) P50, P75, and P90 estimates with clear uncertainty analysis. (4) Inter-annual variability assessment. (5) Detailed loss waterfall including: shading, soiling, temperature, mismatch, wiring, inverter, transformer, grid, availability, degradation, curtailment. (6) Sensitivity analysis on key assumptions. (7) Independent review by a reputable technical advisor (e.g., DNV, WSP, Fichtner, Black & Veatch). P50 exceedance probability should be used for equity returns; P90 for debt sizing.",
    confidence: "high",
    tags: ["energy_yield", "bankability", "irradiance", "P50", "P90"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["irradiance", "uncertainty", "financial model"],
  },
  // ============================================================
  // REGIONAL INSIGHTS
  // ============================================================
  {
    category: "regional_insight",
    topic: "Oman Solar Market and Regulatory Framework",
    content: "Oman's renewable energy program targets 30% renewable energy by 2030. Key regulatory bodies: Authority for Public Services Regulation (APSR) for licensing, Oman Electricity Transmission Company (OETC) for grid, Ministry of Energy and Minerals (MEM) for land allocation. Grid connection is typically at 132kV or 400kV depending on project size. Land allocation requires MEM approval. ESIA requirements are governed by the Environment Authority. Oman's climate is characterized by high irradiance (GHI 2,000-2,200 kWh/m²/year), high temperatures (ambient 45-50°C peak), low humidity in interior regions, and occasional sandstorms affecting soiling. Grid infrastructure is concentrated along the coast with limited inland transmission capacity.",
    confidence: "high",
    tags: ["oman", "regulatory", "market", "MENA"],
    applicability: ["solar", "oman", "MENA"],
    relatedTopics: ["OETC", "APSR", "MEM", "grid connection"],
  },
  {
    category: "regional_insight",
    topic: "MENA Region Solar Project Considerations",
    content: "Solar projects in the MENA region face unique considerations: (1) High ambient temperatures significantly reduce module output (temperature coefficient losses of 10-15%). (2) Soiling from sand and dust requires regular cleaning schedules and water availability assessment. (3) High UV exposure may accelerate module degradation — prefer modules with enhanced UV resistance. (4) Bifacial modules perform well due to high ground albedo in desert environments (albedo 0.25-0.40). (5) Single-axis trackers are preferred for utility-scale due to energy gain of 15-25% over fixed-tilt. (6) Water scarcity may limit cleaning options — consider robotic cleaning or anti-soiling coatings. (7) Grid infrastructure may be limited in remote desert locations. (8) Sand/dust ingress protection (IP65+) is important for inverters and electrical equipment.",
    confidence: "high",
    tags: ["MENA", "desert", "temperature", "soiling", "bifacial"],
    applicability: ["solar", "MENA", "utility-scale"],
    relatedTopics: ["module selection", "cleaning", "tracker", "grid"],
  },
  // ============================================================
  // TECHNICAL STANDARDS
  // ============================================================
  {
    category: "technical_standard",
    topic: "Grid Connection Technical Requirements",
    content: "Utility-scale solar projects connecting to transmission grids typically need to comply with: (1) Grid code requirements for voltage and frequency regulation. (2) Fault ride-through (FRT) capability — ability to remain connected during grid faults. (3) Reactive power capability — typically ±0.95 power factor at POC. (4) Ramp rate limits — typically 10-20% of rated capacity per minute. (5) Frequency response — primary and secondary frequency control. (6) Harmonic distortion limits — THD typically <5% at POC. (7) Protection coordination with grid operator. (8) SCADA/communication requirements for remote monitoring and control. (9) Grid-forming vs grid-following inverter requirements (increasingly grid-forming is required for high-RE grids). Connection voltage levels: <50 MW typically 33-66kV, 50-200 MW typically 132kV, >200 MW typically 220-400kV.",
    confidence: "high",
    tags: ["grid", "connection", "technical", "inverter", "compliance"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["grid code", "inverter", "protection", "SCADA"],
  },
  {
    category: "technical_standard",
    topic: "Solar PV Module Selection Criteria for DD",
    content: "Key module selection criteria for due diligence assessment: (1) Tier 1 manufacturer status (Bloomberg BNEF). (2) IEC 61215 and IEC 61730 certification. (3) Extended stress testing results (IEC 62804 for PID, IEC 63209 for LeTID). (4) Independent test results from PVEL, TÜV, or equivalent. (5) Warranty terms: 12-15 year product warranty, 25-30 year performance warranty. (6) Temperature coefficient: prefer <-0.35%/°C for hot climates. (7) Bifacial factor: 70-85% for bifacial modules. (8) Module efficiency: >20% for mono-PERC, >22% for TOPCon/HJT. (9) Manufacturing capacity and financial stability of manufacturer. (10) Track record in similar climate conditions.",
    confidence: "high",
    tags: ["module", "selection", "quality", "certification"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["technology", "warranty", "degradation", "bankability"],
  },
  // ============================================================
  // PATTERNS
  // ============================================================
  {
    category: "pattern",
    topic: "Common Data Quality Issues in Project Databases",
    content: "Frequently observed data quality issues in solar project fact databases: (1) Inconsistent units — MW vs MWp vs MWac vs MWdc (always clarify which). (2) Contradictory capacity figures from different source documents. (3) Missing DC/AC ratio when both capacities are stated (should be calculated and verified). (4) Area figures that don't match power density expectations for the stated technology. (5) Financial figures without clear currency or date basis. (6) Extracted facts with low confidence that haven't been verified. (7) Duplicate facts from overlapping document extractions. (8) Outdated facts from superseded document versions. Best practice: always cross-reference key metrics from multiple source documents and flag discrepancies.",
    confidence: "high",
    tags: ["data_quality", "validation", "extraction"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["fact verification", "cross-referencing", "data integrity"],
  },
  {
    category: "pattern",
    topic: "Financial Model Key Assumptions to Verify",
    content: "Critical financial model assumptions that should be verified during DD: (1) Energy yield — must match independent assessment, not developer's optimistic case. (2) Degradation rate — should align with module warranty and independent assessment. (3) Availability — 97-99% is typical; above 99% needs justification. (4) Curtailment — must reflect grid operator's stated policy and historical data. (5) O&M costs — $5-15/kW/year for utility-scale, escalating with inflation. (6) Insurance — 0.3-0.5% of CAPEX per year. (7) Debt terms — interest rate, tenor, DSCR requirements. (8) Tax assumptions — corporate tax, depreciation, tax holidays. (9) Inflation and escalation rates. (10) Discount rate / WACC assumptions. (11) Terminal value or decommissioning cost assumptions.",
    confidence: "high",
    tags: ["financial_model", "assumptions", "verification"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["CAPEX", "OPEX", "revenue", "IRR", "DSCR"],
  },
  // ============================================================
  // LESSONS LEARNED
  // ============================================================
  {
    category: "lesson_learned",
    topic: "Grid Connection Delays as Major Project Risk",
    content: "Grid connection is consistently one of the highest-risk areas for solar project development. Common issues include: (1) Transmission capacity constraints requiring expensive grid reinforcement. (2) Long lead times for grid connection agreements (6-24 months). (3) Changes in grid code requirements during development. (4) Substation construction delays. (5) Curtailment risk not adequately assessed during development. (6) Grid operator requiring expensive protection equipment. Mitigation: Early engagement with grid operator, independent grid study, contingency budget for grid works (typically 10-20% of grid connection cost), and clear contractual allocation of grid risk between developer and offtaker.",
    confidence: "high",
    tags: ["grid", "risk", "delay", "lesson"],
    applicability: ["solar", "utility-scale", "global"],
    relatedTopics: ["grid connection", "transmission", "curtailment"],
  },
];

/**
 * Seed the knowledge base with foundational solar DD knowledge.
 * Skips entries that already exist (based on topic matching).
 */
export async function seedKnowledgeBase(db: MySql2Database<any>): Promise<{
  added: number;
  skipped: number;
  total: number;
}> {
  let added = 0;
  let skipped = 0;

  for (const entry of SEED_DATA) {
    // Check if similar entry already exists
    const { sql: sqlFn } = await import("drizzle-orm");
    const existing = await db
      .select({ id: agentKnowledgeBase.id })
      .from(agentKnowledgeBase)
      .where(sqlFn`LOWER(${agentKnowledgeBase.topic}) = ${entry.topic.toLowerCase()}`)
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const id = uuidv4();
    await db.insert(agentKnowledgeBase).values({
      id,
      category: entry.category,
      topic: entry.topic,
      content: entry.content,
      confidence: entry.confidence,
      sourceCount: 1,
      metadata: {
        tags: entry.tags,
        relatedTopics: entry.relatedTopics,
        applicability: entry.applicability,
      },
    });
    added++;
  }

  console.log(`[SEED] Knowledge base seeded: ${added} added, ${skipped} skipped, ${SEED_DATA.length} total entries`);
  return { added, skipped, total: SEED_DATA.length };
}

/**
 * Get the count of seed entries available
 */
export function getSeedEntryCount(): number {
  return SEED_DATA.length;
}
