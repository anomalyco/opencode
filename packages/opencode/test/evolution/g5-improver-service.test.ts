import { describe, expect, test } from "bun:test"
import { suggest, type Suggestion } from "@/evolution/evolution/improver"
import type { AnalysisReport } from "@/evolution/evolution/analyzer"
import type { MetricsSnapshot } from "@/evolution/evolution/metrics"

function makeSnapshot(overrides: Partial<MetricsSnapshot>): MetricsSnapshot {
  return {
    totalProposals: null,
    acceptanceRate: null,
    avgTimeToAcceptance: null,
    proposalChurn: null,
    totalReconciliations: null,
    avgConfidenceScore: null,
    avgParticipantsPerReconciliation: null,
    budgetUtilization: null,
    diversityIndex: null,
    rejectionCodeFrequency: null,
    reconciliationOutcomeCounts: null,
    advisorActivity: null,
    ...overrides,
  }
}

function makeReport(overrides: Partial<AnalysisReport> & { snapshot?: Partial<MetricsSnapshot> }): AnalysisReport {
  const snapshot = makeSnapshot(overrides.snapshot ?? {})
  return {
    generatedAt: Date.now(),
    basedOnSnapshot: snapshot,
    failurePattern: { dominantRejectionCode: null, dominantRejectionRate: null, patternClassification: "INSUFFICIENT_DATA" },
    advisorAnalysis: { advisorExecutionRate: null, enrichmentEffect: "INSUFFICIENT_DATA", underperformingAdvisors: [] },
    configAnalysis: { thresholdAssessment: "INSUFFICIENT_DATA", budgetAssessment: "UNAVAILABLE" },
    usageTrend: { dataPoints: 1, trendDirection: "INSUFFICIENT_DATA" },
    overallAssessment: "INSUFFICIENT_DATA",
    assessmentRationale: "Test report",
    ...overrides,
  }
}

describe("G5 ImproverService", () => {
  test("TG-IMPROVER-SYNC: suggest() returns array synchronously (no Effect)", () => {
    const r = makeReport({})
    const result = suggest(r)
    expect(Array.isArray(result)).toBe(true)
  })

  test("TG-IMPROVER-METRIC-SOURCE: every suggestion has metricSource.length > 0", () => {
    const r = makeReport({
      overallAssessment: "CRITICAL",
      snapshot: { totalProposals: 10, acceptanceRate: 0.1, rejectionCodeFrequency: { SCHEMA_INVALID: 9 }, reconciliationOutcomeCounts: { submitted: 2, belowThreshold: 0, noCandidates: 0 } },
      configAnalysis: { thresholdAssessment: "TOO_HIGH", budgetAssessment: "CONSTRAINED" },
      failurePattern: { dominantRejectionCode: "SCHEMA_INVALID", dominantRejectionRate: 0.9, patternClassification: "SCHEMA_QUALITY_ISSUE" },
    })
    const results = suggest(r)
    expect(results.length).toBeGreaterThan(0)
    for (const s of results) {
      expect(s.metricSource.length).toBeGreaterThan(0)
    }
  })

  test("TG-IMPROVER-HEALTHY: HEALTHY report → 0 suggestions", () => {
    const r = makeReport({
      overallAssessment: "HEALTHY",
      snapshot: { totalProposals: 50, acceptanceRate: 0.9, rejectionCodeFrequency: {}, reconciliationOutcomeCounts: { submitted: 40, belowThreshold: 5, noCandidates: 5 } },
      failurePattern: { dominantRejectionCode: null, dominantRejectionRate: null, patternClassification: "HEALTHY" },
      configAnalysis: { thresholdAssessment: "HEALTHY", budgetAssessment: "UNAVAILABLE" },
    })
    expect(suggest(r)).toHaveLength(0)
  })

  test("TG-IMPROVER-THRESHOLD: belowThresholdRate > 0.5 → includes CONFIG_THRESHOLD", () => {
    const r = makeReport({
      overallAssessment: "NEEDS_ATTENTION",
      snapshot: { totalProposals: 10, reconciliationOutcomeCounts: { submitted: 2, belowThreshold: 7, noCandidates: 1 } },
      configAnalysis: { thresholdAssessment: "TOO_HIGH", budgetAssessment: "UNAVAILABLE" },
    })
    const results = suggest(r)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some((s) => s.category === "CONFIG_THRESHOLD")).toBe(true)
  })

  test("TG-IMPROVER-CRITICAL: CRITICAL + acceptanceRate < 0.2 → includes MODE_ADJUSTMENT", () => {
    const r = makeReport({
      overallAssessment: "CRITICAL",
      snapshot: { totalProposals: 25, acceptanceRate: 0.1 },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "MODE_ADJUSTMENT")).toBe(true)
  })

  test("CRITICAL + acceptanceRate >= 0.2 does NOT produce MODE_ADJUSTMENT", () => {
    const r = makeReport({
      overallAssessment: "CRITICAL",
      snapshot: { totalProposals: 25, acceptanceRate: 0.3 },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "MODE_ADJUSTMENT")).toBe(false)
  })

  test("SCHEMA_QUALITY_ISSUE → includes AGENT_INSTRUCTION", () => {
    const r = makeReport({
      snapshot: { totalProposals: 15 },
    failurePattern: { dominantRejectionCode: "SCHEMA_INVALID", dominantRejectionRate: 0.6, patternClassification: "SCHEMA_QUALITY_ISSUE" },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "AGENT_INSTRUCTION")).toBe(true)
  })

  test("budget CONSTRAINED → includes CONFIG_BUDGET", () => {
    const r = makeReport({
      snapshot: { totalProposals: 15 },
      configAnalysis: { thresholdAssessment: "INSUFFICIENT_DATA", budgetAssessment: "CONSTRAINED" },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "CONFIG_BUDGET")).toBe(true)
  })

  test("Each suggestion has required fields (suggestionId, rationale, confidence, howToApply)", () => {
    const r = makeReport({
      overallAssessment: "CRITICAL",
      snapshot: { totalProposals: 10, acceptanceRate: 0.1, rejectionCodeFrequency: { SCHEMA_INVALID: 9 }, reconciliationOutcomeCounts: { submitted: 2, belowThreshold: 7, noCandidates: 1 } },
      configAnalysis: { thresholdAssessment: "TOO_HIGH", budgetAssessment: "CONSTRAINED" },
      failurePattern: { dominantRejectionCode: "SCHEMA_INVALID", dominantRejectionRate: 0.9, patternClassification: "SCHEMA_QUALITY_ISSUE" },
    })
    const results = suggest(r)
    expect(results.length).toBeGreaterThan(0)
    for (const s of results) {
      expect(s.suggestionId).toMatch(/^S-\d{8}-\d{3}$/)
      expect(typeof s.rationale).toBe("string")
      expect(["low", "medium", "high"]).toContain(s.confidence)
      expect(typeof s.howToApply).toBe("string")
    }
  })
})
