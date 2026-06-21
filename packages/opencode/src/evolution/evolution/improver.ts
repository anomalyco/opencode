import type { AnalysisReport } from "./analyzer"

export type SuggestionCategory =
  | "CONFIG_THRESHOLD"
  | "CONFIG_BUDGET"
  | "AGENT_INSTRUCTION"
  | "MODE_ADJUSTMENT"

export interface Suggestion {
  readonly suggestionId: string
  readonly category: SuggestionCategory
  readonly targetField?: string
  readonly targetAgentId?: string
  readonly currentValue?: unknown
  readonly suggestedValue?: unknown
  readonly rationale: string
  readonly confidence: "low" | "medium" | "high"
  readonly metricSource: readonly string[]
  readonly howToApply: string
  readonly memorySource: "self_generated" | "external" | "mixed" | "unknown"
}

export interface Interface {
  readonly suggest: (report: AnalysisReport) => readonly Suggestion[]
}

let seq = 0
function nextId(): string {
  const now = new Date()
  const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
  seq++
  return `S-${ds}-${String(seq).padStart(3, "0")}`
}

function ruleThreshold(report: AnalysisReport): Suggestion | null {
  if (report.configAnalysis.thresholdAssessment !== "TOO_HIGH") return null
  const totalProposals = report.basedOnSnapshot.totalProposals
  if (!totalProposals || totalProposals < 10) return null
  const outcomes = report.basedOnSnapshot.reconciliationOutcomeCounts
  if (!outcomes) return null
  const total = outcomes.submitted + outcomes.belowThreshold + outcomes.noCandidates
  if (total === 0) return null
  const belowThresholdRate = outcomes.belowThreshold / total
  if (belowThresholdRate <= 0.5) return null

  return {
    suggestionId: nextId(),
    category: "CONFIG_THRESHOLD",
    targetField: "ConfigEvolution.minCandidateConfidence",
    suggestedValue: 0.15,
    rationale: `Below-threshold rate is ${(belowThresholdRate * 100).toFixed(0)}%. Lowering the threshold may increase the candidate pool. Verify rejection patterns are not caused by data quality issues.`,
    confidence: belowThresholdRate > 0.8 ? "high" : "medium",
    metricSource: ["M-03", "M-01"],
    howToApply: `Edit your OpenCode config and set evolution.minCandidateConfidence to 0.15, then run \`opencode evolution evaluate\` to observe effect.`,
    memorySource: "self_generated",
  }
}

function ruleBudget(report: AnalysisReport): Suggestion | null {
  if (report.configAnalysis.budgetAssessment !== "CONSTRAINED") return null
  const totalProposals = report.basedOnSnapshot.totalProposals
  if (!totalProposals || totalProposals < 10) return null
  return {
    suggestionId: nextId(),
    category: "CONFIG_BUDGET",
    targetField: "ConfigEvolution.contextBudget",
    suggestedValue: 8192,
    rationale: "Context budget utilization is high. Frequent truncation may reduce context quality for the Decision Engine.",
    confidence: "medium",
    metricSource: ["M-08"],
    howToApply: `Edit your OpenCode config and set evolution.contextBudget to 8192, then run \`opencode evolution evaluate\` to observe effect.`,
    memorySource: "self_generated",
  }
}

function ruleInstruction(report: AnalysisReport): Suggestion | null {
  if (report.failurePattern.patternClassification !== "SCHEMA_QUALITY_ISSUE") return null
  const totalProposals = report.basedOnSnapshot.totalProposals
  if (!totalProposals || totalProposals < 10) return null
  const rate = report.failurePattern.dominantRejectionRate
  return {
    suggestionId: nextId(),
    category: "AGENT_INSTRUCTION",
    targetAgentId: "context-analyst",
    rationale: `SCHEMA_INVALID rejection rate is ${rate != null ? (rate * 100).toFixed(0) : "unknown"}%. The agent instruction may be producing malformed proposals. Review the instruction for clarity.`,
    confidence: rate != null && rate > 0.5 ? "high" : "low",
    metricSource: ["M-02"],
    howToApply: `Review the context-analyst agent instruction in your Evolution configuration. Check the proposal schema requirements and update the instruction to produce valid proposals.`,
    memorySource: "self_generated",
  }
}

function ruleMode(report: AnalysisReport): Suggestion | null {
  const totalProposals = report.basedOnSnapshot.totalProposals
  if (!totalProposals || totalProposals < 20) return null
  const ar = report.basedOnSnapshot.acceptanceRate
  if (report.overallAssessment !== "CRITICAL" || ar == null || ar >= 0.2) return null
  return {
    suggestionId: nextId(),
    category: "MODE_ADJUSTMENT",
    rationale: `Acceptance rate is ${(ar * 100).toFixed(0)}%. In autonomous mode, this means frequent low-quality decisions. Consider switching to assist mode until root cause is identified.`,
    confidence: "high",
    metricSource: ["M-01", "M-02"],
    howToApply: `Set evolution.mode to "assist" in your OpenCode config. This pauses autonomous execution until underlying issues are resolved.`,
    memorySource: "self_generated",
  }
}

export function suggest(report: AnalysisReport): readonly Suggestion[] {
  const results: Suggestion[] = []
  for (const rule of [ruleThreshold, ruleBudget, ruleInstruction, ruleMode]) {
    const s = rule(report)
    if (s) results.push(s)
  }
  return results
}

export * as EvolutionImprover from "./improver"
