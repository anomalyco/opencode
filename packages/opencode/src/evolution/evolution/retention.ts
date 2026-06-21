import { Context, Duration, Effect, Layer } from "effect"
import { Evolution } from "@/evolution/index"

export interface LatencyBenchmark {
  readonly p50: number | null
  readonly p95: number | null
  readonly p99: number | null
}

export interface RetentionAnalysis {
  readonly totalProposals: number
  readonly totalReconciliationLogs: number
  readonly totalStorageBytes: number
  readonly proposalsPerSession: number | null
  readonly projectedProposalsIn30Sessions: number | null
  readonly projectedProposalsIn100Sessions: number | null
  readonly listByStatusLatencyMs: LatencyBenchmark
  readonly recommendation: "DEFER" | "PLAN" | "IMPLEMENT"
  readonly recommendationRationale: string
}

export interface Interface {
  readonly analyze: () => Effect.Effect<RetentionAnalysis, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RetentionAnalysisService") {}

function computePercentiles(sorted: readonly number[]): LatencyBenchmark {
  if (sorted.length === 0) return { p50: null, p95: null, p99: null }
  const at = (p: number) => {
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1)
    return sorted[idx]
  }
  return { p50: at(50), p95: at(95), p99: at(99) }
}

function recommend(analysis: {
  totalProposals: number
  totalStorageBytes: number
  p95Latency: number | null
  projected100: number | null
}): { recommendation: "DEFER" | "PLAN" | "IMPLEMENT"; rationale: string } {
  const reasons: string[] = []
  let severity = 0

  if (analysis.totalProposals > 5000) {
    severity = 2
    reasons.push(`Total proposals (${analysis.totalProposals}) exceeds IMPLEMENT threshold (>5,000)`)
  } else if (analysis.totalProposals >= 1000) {
    severity = Math.max(severity, 1)
    reasons.push(`Total proposals (${analysis.totalProposals}) is in PLAN range (1,000–5,000)`)
  }

  if (analysis.totalStorageBytes > 100_000_000) {
    severity = 2
    reasons.push(`Total storage (${(analysis.totalStorageBytes / 1_000_000).toFixed(1)}MB) exceeds IMPLEMENT threshold (>100MB)`)
  } else if (analysis.totalStorageBytes >= 10_000_000) {
    severity = Math.max(severity, 1)
    reasons.push(`Total storage (${(analysis.totalStorageBytes / 1_000_000).toFixed(1)}MB) is in PLAN range (10–100MB)`)
  }

  if (analysis.p95Latency != null && analysis.p95Latency > 500) {
    severity = 2
    reasons.push(`p95 latency (${analysis.p95Latency.toFixed(0)}ms) exceeds IMPLEMENT threshold (>500ms)`)
  } else if (analysis.p95Latency != null && analysis.p95Latency >= 100) {
    severity = Math.max(severity, 1)
    reasons.push(`p95 latency (${analysis.p95Latency.toFixed(0)}ms) is in PLAN range (100–500ms)`)
  }

  if (analysis.projected100 != null && analysis.projected100 > 10000) {
    severity = 2
    reasons.push(`Projected proposals @100 sessions (${analysis.projected100}) exceeds IMPLEMENT threshold (>10,000)`)
  } else if (analysis.projected100 != null && analysis.projected100 >= 2000) {
    severity = Math.max(severity, 1)
    reasons.push(`Projected proposals @100 sessions (${analysis.projected100}) is in PLAN range (2,000–10,000)`)
  }

  if (severity === 0) {
    reasons.push("All thresholds are within DEFER range — no retention pressure.")
  }

  const recommendation = severity >= 2 ? "IMPLEMENT" : severity >= 1 ? "PLAN" : "DEFER"
  return { recommendation, rationale: reasons.join(". ") + "." }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const evolution = yield* Evolution.Service

    const analyze = Effect.fn("RetentionAnalysisService.analyze")(function* () {
      const decisions = evolution.decisions()

      const [stats, proposals, logs] = yield* Effect.all([
        decisions.getStorageStats().pipe(Effect.catch(() => Effect.succeed({ proposalCount: 0, proposalBytes: 0, reconcilCount: 0, reconcilBytes: 0 }))),
        decisions.listProposals().pipe(Effect.catch(() => Effect.succeed([]))),
        decisions.getReconciliationLogs().pipe(Effect.catch(() => Effect.succeed([]))),
      ])

      const totalProposals = stats.proposalCount
      const totalReconciliationLogs = stats.reconcilCount
      const totalStorageBytes = stats.proposalBytes + stats.reconcilBytes

      const sessionIds = new Set<string>()
      for (const p of proposals) {
        if (p.origin.sessionId) sessionIds.add(p.origin.sessionId)
      }
      const uniqueSessions = sessionIds.size
      const proposalsPerSession = uniqueSessions > 0 ? totalProposals / uniqueSessions : null
      const projectedProposalsIn30Sessions = proposalsPerSession != null ? Math.round(proposalsPerSession * 30) : null
      const projectedProposalsIn100Sessions = proposalsPerSession != null ? Math.round(proposalsPerSession * 100) : null

      const latencySamples: number[] = []
      for (let i = 0; i < 5; i++) {
        const start = Date.now()
        yield* decisions.listProposals().pipe(Effect.catch(() => Effect.succeed([])))
        const elapsed = Date.now() - start
        latencySamples.push(elapsed)
      }
      latencySamples.sort((a, b) => a - b)
      const latency = computePercentiles(latencySamples)

      const { recommendation, rationale } = recommend({
        totalProposals,
        totalStorageBytes,
        p95Latency: latency.p95,
        projected100: projectedProposalsIn100Sessions,
      })

      return {
        totalProposals,
        totalReconciliationLogs,
        totalStorageBytes,
        proposalsPerSession,
        projectedProposalsIn30Sessions,
        projectedProposalsIn100Sessions,
        listByStatusLatencyMs: latency,
        recommendation,
        recommendationRationale: rationale,
      }
    })

    return Service.of({ analyze })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Evolution.defaultLayer),
)

export * as RetentionService from "./retention"
