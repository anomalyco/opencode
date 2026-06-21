import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { EvolutionAnalyzer, type AnalysisReport } from "@/evolution/evolution/analyzer"
import { MetricsService, type MetricsSnapshot } from "@/evolution/evolution/metrics"

function makeSnapshot(overrides: Partial<MetricsSnapshot> & { rejectionCodeFrequency?: Record<string, number> }): MetricsSnapshot {
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

function runAnalyze(snapshot: MetricsSnapshot): AnalysisReport {
  return Effect.runSync(
    Effect.gen(function* () {
      const svc = yield* EvolutionAnalyzer.Service
      return yield* svc.analyze(snapshot)
    }).pipe(Effect.provide(EvolutionAnalyzer.defaultLayer)),
  )
}

describe("G5 AnalyzerService", () => {
  test("TG-ANALYZER-PURE: analyze is a pure function — always succeeds, never fails", () => {
    const svc = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* EvolutionAnalyzer.Service
        return svc
      }).pipe(Effect.provide(EvolutionAnalyzer.defaultLayer)),
    )
    expect(typeof svc.analyze).toBe("function")
    // calling with empty snapshot never throws
    const r = Effect.runSync(svc.analyze(makeSnapshot({})))
    expect(r.overallAssessment).toBe("INSUFFICIENT_DATA")
  })

  test("TG-ANALYZER-INSUFFICIENT: 0 proposals → overallAssessment = INSUFFICIENT_DATA", () => {
    const r = runAnalyze(makeSnapshot({ totalProposals: 0 }))
    expect(r.overallAssessment).toBe("INSUFFICIENT_DATA")
    expect(r.assessmentRationale).toContain("0 proposals")
  })

  test("TG-ANALYZER-INSUFFICIENT: 4 proposals → overallAssessment = INSUFFICIENT_DATA", () => {
    const r = runAnalyze(makeSnapshot({ totalProposals: 4 }))
    expect(r.overallAssessment).toBe("INSUFFICIENT_DATA")
    expect(r.assessmentRationale).toContain("4 proposals")
  })

  test("TG-ANALYZER-HEALTHY: high acceptance, low churn (<30%), no dominant rejection code", () => {
    // 5 rejected out of 50 = 10% churn. Codes spread so none exceeds its threshold.
    const r = runAnalyze(makeSnapshot({
      totalProposals: 50,
      acceptanceRate: 0.9,
      proposalChurn: 0.1,
      rejectionCodeFrequency: { VALIDATION_TIMEOUT: 1, DUPLICATE_KEY: 2, SCHEMA_INVALID: 1, UNKNOWN: 1 },
      reconciliationOutcomeCounts: { submitted: 40, belowThreshold: 5, noCandidates: 5 },
    }))
    expect(r.overallAssessment).toBe("HEALTHY")
    expect(r.failurePattern.patternClassification).toBe("HEALTHY")
    expect(r.configAnalysis.thresholdAssessment).toBe("HEALTHY")
  })

  test("TG-ANALYZER-CRITICAL: 90% SCHEMA_INVALID + acceptanceRate < 0.2 → CRITICAL + SCHEMA_QUALITY_ISSUE", () => {
    const r = runAnalyze(makeSnapshot({
      totalProposals: 10,
      acceptanceRate: 0.1,
      proposalChurn: 0.9,
      rejectionCodeFrequency: { SCHEMA_INVALID: 9 },
      reconciliationOutcomeCounts: { submitted: 2, belowThreshold: 0, noCandidates: 0 },
    }))
    expect(r.overallAssessment).toBe("CRITICAL")
    expect(r.failurePattern.patternClassification).toBe("SCHEMA_QUALITY_ISSUE")
    expect(r.failurePattern.dominantRejectionCode).toBe("SCHEMA_INVALID")
    expect(r.failurePattern.dominantRejectionRate).toBeCloseTo(1, 5)
    expect(r.assessmentRationale).toContain("Critical")
  })

  test("TG-ANALYZER-TREND: <3 data points → trendDirection = INSUFFICIENT_DATA", () => {
    const r = runAnalyze(makeSnapshot({
      totalProposals: 10,
      acceptanceRate: 0.5,
    }))
    expect(r.usageTrend.dataPoints).toBe(1)
    expect(r.usageTrend.trendDirection).toBe("INSUFFICIENT_DATA")
  })

  test("Failure pattern: TIMEOUT_PRESSURE when VALIDATION_TIMEOUT > 20%", () => {
    const r = runAnalyze(makeSnapshot({
      totalProposals: 10,
      rejectionCodeFrequency: { VALIDATION_TIMEOUT: 3, SCHEMA_INVALID: 1 },
      reconciliationOutcomeCounts: { submitted: 5, belowThreshold: 0, noCandidates: 0 },
    }))
    expect(r.failurePattern.patternClassification).toBe("TIMEOUT_PRESSURE")
  })

  test("Failure pattern: DUPLICATE_SATURATION when DUPLICATE_KEY > 50%", () => {
    const r = runAnalyze(makeSnapshot({
      totalProposals: 10,
      rejectionCodeFrequency: { DUPLICATE_KEY: 6, SCHEMA_INVALID: 1 },
      reconciliationOutcomeCounts: { submitted: 5, belowThreshold: 0, noCandidates: 0 },
    }))
    expect(r.failurePattern.patternClassification).toBe("DUPLICATE_SATURATION")
  })

  test("Failure pattern: AUTHORITY_MISCONFIGURED when AUTHORITY_VIOLATION > 0 and no higher-priority pattern", () => {
    const r = runAnalyze(makeSnapshot({
      totalProposals: 10,
      rejectionCodeFrequency: { AUTHORITY_VIOLATION: 1, DUPLICATE_KEY: 2, VALIDATION_TIMEOUT: 1, SCHEMA_INVALID: 1 },
      reconciliationOutcomeCounts: { submitted: 5, belowThreshold: 0, noCandidates: 0 },
    }))
    expect(r.failurePattern.patternClassification).toBe("AUTHORITY_MISCONFIGURED")
  })

  test("Failure pattern: HEALTHY when < 30% rejection and no dominant code", () => {
    // 5 rejected out of 50 = 10% churn. Codes spread: each is at or below its threshold.
    const r = runAnalyze(makeSnapshot({
      totalProposals: 50,
      acceptanceRate: 0.9,
      proposalChurn: 0.1,
      rejectionCodeFrequency: { SCHEMA_INVALID: 1, VALIDATION_TIMEOUT: 1, DUPLICATE_KEY: 1, UNKNOWN: 2 },
      reconciliationOutcomeCounts: { submitted: 40, belowThreshold: 3, noCandidates: 3 },
    }))
    expect(r.failurePattern.patternClassification).toBe("HEALTHY")
  })

  test("Config: TOO_HIGH when belowThreshold > 50%", () => {
    const r = runAnalyze(makeSnapshot({
      totalProposals: 10,
      reconciliationOutcomeCounts: { submitted: 3, belowThreshold: 6, noCandidates: 1 },
    }))
    expect(r.configAnalysis.thresholdAssessment).toBe("TOO_HIGH")
  })

  test("Config: budget is always UNAVAILABLE", () => {
    const r = runAnalyze(makeSnapshot({ totalProposals: 10 }))
    expect(r.configAnalysis.budgetAssessment).toBe("UNAVAILABLE")
  })

  test("Advisor: enrichmentEffect is always INSUFFICIENT_DATA", () => {
    const r = runAnalyze(makeSnapshot({ totalProposals: 10 }))
    expect(r.advisorAnalysis.enrichmentEffect).toBe("INSUFFICIENT_DATA")
  })

  test("Report includes all required sections", () => {
    const r = runAnalyze(makeSnapshot({ totalProposals: 10 }))
    expect(r).toHaveProperty("generatedAt")
    expect(r).toHaveProperty("basedOnSnapshot")
    expect(r).toHaveProperty("failurePattern")
    expect(r).toHaveProperty("advisorAnalysis")
    expect(r).toHaveProperty("configAnalysis")
    expect(r).toHaveProperty("usageTrend")
    expect(r).toHaveProperty("overallAssessment")
    expect(r).toHaveProperty("assessmentRationale")
  })
})
