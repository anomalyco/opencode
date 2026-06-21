import { describe, expect, test } from "bun:test"
import { suggest } from "@/evolution/evolution/improver"
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

describe("F-03 — Minimum Data Guard", () => {
  test("no suggestion when totalProposals < 10 for CONFIG rules", () => {
    const r = makeReport({
      overallAssessment: "NEEDS_ATTENTION",
      snapshot: { totalProposals: 5, reconciliationOutcomeCounts: { submitted: 0, belowThreshold: 5, noCandidates: 0 } },
      configAnalysis: { thresholdAssessment: "TOO_HIGH", budgetAssessment: "CONSTRAINED" },
      failurePattern: { dominantRejectionCode: "SCHEMA_INVALID", dominantRejectionRate: 0.9, patternClassification: "SCHEMA_QUALITY_ISSUE" },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "CONFIG_THRESHOLD")).toBe(false)
    expect(results.some((s) => s.category === "CONFIG_BUDGET")).toBe(false)
    expect(results.some((s) => s.category === "AGENT_INSTRUCTION")).toBe(false)
  })

  test("no MODE_ADJUSTMENT when totalProposals < 20", () => {
    const r = makeReport({
      overallAssessment: "CRITICAL",
      snapshot: { totalProposals: 15, acceptanceRate: 0.05 },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "MODE_ADJUSTMENT")).toBe(false)
  })

  test("CONFIG rules fire when totalProposals >= 10", () => {
    const r = makeReport({
      snapshot: { totalProposals: 10, reconciliationOutcomeCounts: { submitted: 1, belowThreshold: 8, noCandidates: 1 } },
      configAnalysis: { thresholdAssessment: "TOO_HIGH", budgetAssessment: "CONSTRAINED" },
      failurePattern: { dominantRejectionCode: "SCHEMA_INVALID", dominantRejectionRate: 0.9, patternClassification: "SCHEMA_QUALITY_ISSUE" },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "CONFIG_THRESHOLD")).toBe(true)
    expect(results.some((s) => s.category === "CONFIG_BUDGET")).toBe(true)
    expect(results.some((s) => s.category === "AGENT_INSTRUCTION")).toBe(true)
  })

  test("MODE_ADJUSTMENT fires when totalProposals >= 20", () => {
    const r = makeReport({
      overallAssessment: "CRITICAL",
      snapshot: { totalProposals: 20, acceptanceRate: 0.1 },
    })
    const results = suggest(r)
    expect(results.some((s) => s.category === "MODE_ADJUSTMENT")).toBe(true)
  })
})
