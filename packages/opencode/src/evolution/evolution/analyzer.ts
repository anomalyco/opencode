import { Effect, Layer, Context } from "effect"
import type { MetricsSnapshot } from "./metrics"

export type PatternClassification =
  | "SCHEMA_QUALITY_ISSUE"
  | "TIMEOUT_PRESSURE"
  | "DUPLICATE_SATURATION"
  | "AUTHORITY_MISCONFIGURED"
  | "HEALTHY"
  | "INSUFFICIENT_DATA"

export type EnrichmentEffect =
  | "POSITIVE"
  | "NEGATIVE"
  | "NEUTRAL"
  | "INSUFFICIENT_DATA"

export type ThresholdAssessment =
  | "TOO_HIGH"
  | "TOO_LOW"
  | "HEALTHY"
  | "INSUFFICIENT_DATA"

export type BudgetAssessment =
  | "CONSTRAINED"
  | "WASTEFUL"
  | "HEALTHY"
  | "UNAVAILABLE"

export type TrendDirection =
  | "IMPROVING"
  | "DEGRADING"
  | "STABLE"
  | "INSUFFICIENT_DATA"

export type OverallAssessment =
  | "HEALTHY"
  | "NEEDS_ATTENTION"
  | "CRITICAL"
  | "INSUFFICIENT_DATA"

export interface FailurePattern {
  readonly dominantRejectionCode: string | null
  readonly dominantRejectionRate: number | null
  readonly patternClassification: PatternClassification
}

export interface AdvisorAnalysis {
  readonly advisorExecutionRate: number | null
  readonly enrichmentEffect: EnrichmentEffect
  readonly underperformingAdvisors: ReadonlyArray<{
    readonly agentId: string
    readonly contributionType: string
    readonly executionCount: number
  }>
}

export interface ConfigAnalysis {
  readonly thresholdAssessment: ThresholdAssessment
  readonly budgetAssessment: BudgetAssessment
}

export interface UsageTrend {
  readonly dataPoints: number
  readonly trendDirection: TrendDirection
}

export interface AnalysisReport {
  readonly generatedAt: number
  readonly basedOnSnapshot: MetricsSnapshot
  readonly failurePattern: FailurePattern
  readonly advisorAnalysis: AdvisorAnalysis
  readonly configAnalysis: ConfigAnalysis
  readonly usageTrend: UsageTrend
  readonly overallAssessment: OverallAssessment
  readonly assessmentRationale: string
}

export interface Interface {
  readonly analyze: (snapshot: MetricsSnapshot) => Effect.Effect<AnalysisReport>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionAnalyzer") {}

function computeFailurePattern(s: MetricsSnapshot): FailurePattern {
  const freq = s.rejectionCodeFrequency
  if (!freq || Object.keys(freq).length === 0) {
    return { dominantRejectionCode: null, dominantRejectionRate: null, patternClassification: "INSUFFICIENT_DATA" }
  }
  const totalRejected = Object.values(freq).reduce((a, b) => a + b, 0)
  let dominant: string | null = null
  let dominantCount = 0
  for (const [code, count] of Object.entries(freq)) {
    if (count > dominantCount) {
      dominant = code
      dominantCount = count
    }
  }
  const dominantRate = dominantCount / totalRejected

  const schemaInvalidRate = (freq["SCHEMA_INVALID"] ?? 0) / totalRejected
  const timeoutRate = (freq["VALIDATION_TIMEOUT"] ?? 0) / totalRejected
  const duplicateRate = (freq["DUPLICATE_KEY"] ?? 0) / totalRejected
  const authorityRate = (freq["AUTHORITY_VIOLATION"] ?? 0) / totalRejected

  const rejectionRate = s.proposalChurn ?? 0
  let classification: PatternClassification
  if (schemaInvalidRate > 0.3) {
    classification = "SCHEMA_QUALITY_ISSUE"
  } else if (timeoutRate > 0.2) {
    classification = "TIMEOUT_PRESSURE"
  } else if (duplicateRate > 0.5) {
    classification = "DUPLICATE_SATURATION"
  } else if (authorityRate > 0) {
    classification = "AUTHORITY_MISCONFIGURED"
  } else if (rejectionRate < 0.3) {
    classification = "HEALTHY"
  } else {
    classification = "INSUFFICIENT_DATA"
  }

  return { dominantRejectionCode: dominant, dominantRejectionRate: dominantRate, patternClassification: classification }
}

function computeAdvisorAnalysis(s: MetricsSnapshot): AdvisorAnalysis {
  const activity = s.advisorActivity
  if (!activity || activity.length === 0) {
    return { advisorExecutionRate: null, enrichmentEffect: "INSUFFICIENT_DATA", underperformingAdvisors: [] }
  }

  const reconCount = s.totalReconciliations ?? 0
  const advisorEntries = activity.filter((a) => a.contributionType !== "proposal" && a.contributionType !== "execution-plan")
  const advisorExecutionRate = reconCount > 0 && advisorEntries.length > 0
    ? advisorEntries.reduce((sum, a) => sum + a.executionCount, 0) / reconCount
    : null

  const executedCounts = advisorEntries.map((a) => a.executionCount)
  const minCount = executedCounts.length > 0 ? Math.min(...executedCounts) : 0
  const underperformingAdvisors = activity.filter((a) => a.executionCount === minCount && minCount < 2)

  return {
    advisorExecutionRate,
    enrichmentEffect: "INSUFFICIENT_DATA",
    underperformingAdvisors,
  }
}

function computeConfigAnalysis(s: MetricsSnapshot): ConfigAnalysis {
  const outcomes = s.reconciliationOutcomeCounts
  let thresholdAssessment: ThresholdAssessment
  if (!outcomes || (outcomes.submitted + outcomes.belowThreshold + outcomes.noCandidates) === 0) {
    thresholdAssessment = "INSUFFICIENT_DATA"
  } else {
    const total = outcomes.submitted + outcomes.belowThreshold + outcomes.noCandidates
    const belowThresholdRate = outcomes.belowThreshold / total
    if (belowThresholdRate > 0.5) {
      thresholdAssessment = "TOO_HIGH"
    } else if (belowThresholdRate === 0 && total > 5) {
      thresholdAssessment = "TOO_LOW"
    } else if (belowThresholdRate >= 0.1 && belowThresholdRate <= 0.4) {
      thresholdAssessment = "HEALTHY"
    } else {
      thresholdAssessment = "INSUFFICIENT_DATA"
    }
  }

  return { thresholdAssessment, budgetAssessment: "UNAVAILABLE" }
}

function computeUsageTrend(s: MetricsSnapshot): UsageTrend {
  return { dataPoints: 1, trendDirection: "INSUFFICIENT_DATA" }
}

function computeOverallAssessment(
  failurePattern: FailurePattern,
  advisorAnalysis: AdvisorAnalysis,
  configAnalysis: ConfigAnalysis,
  totalProposals: number | null,
  acceptanceRate: number | null,
): { assessment: OverallAssessment; rationale: string } {
  if (!totalProposals || totalProposals < 5) {
    return { assessment: "INSUFFICIENT_DATA", rationale: `Only ${totalProposals ?? 0} proposals available — need at least 5 for meaningful analysis.` }
  }

  const reasons: string[] = []
  let isCritical = false

  if (failurePattern.patternClassification === "SCHEMA_QUALITY_ISSUE" || failurePattern.patternClassification === "DUPLICATE_SATURATION") {
    if (acceptanceRate != null && acceptanceRate < 0.2) {
      isCritical = true
      reasons.push(`Critical: ${failurePattern.patternClassification} with acceptance rate of ${(acceptanceRate * 100).toFixed(1)}%.`)
    } else {
      reasons.push(`Concerning failure pattern: ${failurePattern.patternClassification}.`)
    }
  }

  if (configAnalysis.thresholdAssessment === "TOO_HIGH") {
    reasons.push("Threshold may be too high — over 50% of reconciliations are below threshold.")
  }

  if (isCritical) {
    return { assessment: "CRITICAL", rationale: reasons.join(" ") }
  }

  if (reasons.length > 0) {
    return { assessment: "NEEDS_ATTENTION", rationale: reasons.join(" ") }
  }

  return { assessment: "HEALTHY", rationale: "No concerning patterns detected. All metrics within expected ranges." }
}

function computeReport(snapshot: MetricsSnapshot): AnalysisReport {
  const failurePattern = computeFailurePattern(snapshot)
  const advisorAnalysis = computeAdvisorAnalysis(snapshot)
  const configAnalysis = computeConfigAnalysis(snapshot)
  const usageTrend = computeUsageTrend(snapshot)
  const { assessment, rationale } = computeOverallAssessment(
    failurePattern,
    advisorAnalysis,
    configAnalysis,
    snapshot.totalProposals,
    snapshot.acceptanceRate,
  )

  return {
    generatedAt: Date.now(),
    basedOnSnapshot: snapshot,
    failurePattern,
    advisorAnalysis,
    configAnalysis,
    usageTrend,
    overallAssessment: assessment,
    assessmentRationale: rationale,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const analyze = Effect.fn("AnalyzerService.analyze")(function* (snapshot: MetricsSnapshot) {
      return computeReport(snapshot)
    })
    return Service.of({ analyze })
  }),
)

export const defaultLayer = layer

export * as EvolutionAnalyzer from "./analyzer"
