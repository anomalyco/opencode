import { Context, Effect, Layer } from "effect"
import { Evolution } from "@/evolution/index"
import { EvolutionStorageError } from "@/evolution/error"

export interface MetricsSnapshot {
  readonly totalProposals: number | null
  readonly acceptanceRate: number | null
  readonly avgTimeToAcceptance: number | null
  readonly proposalChurn: number | null
  readonly totalReconciliations: number | null
  readonly avgConfidenceScore: number | null
  readonly avgParticipantsPerReconciliation: number | null
  readonly budgetUtilization: number | null
  readonly diversityIndex: number | null
  readonly rejectionCodeFrequency: Record<string, number> | null
  readonly reconciliationOutcomeCounts: {
    readonly submitted: number
    readonly belowThreshold: number
    readonly noCandidates: number
  } | null
  readonly advisorActivity: ReadonlyArray<{ readonly agentId: string; readonly executionCount: number; readonly contributionType: string }> | null
}

export interface Interface {
  readonly snapshot: () => Effect.Effect<MetricsSnapshot, EvolutionStorageError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MetricsService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const evolution = yield* Evolution.Service

    const snapshot = Effect.fn("MetricsService.snapshot")(function* () {
      const decisions = evolution.decisions()
      const proposals = yield* decisions.listProposals().pipe(
        Effect.catchTag("EvolutionDecisionsNotEnabledError", () => Effect.succeed([])),
      )
      const logs = yield* decisions.getReconciliationLogs().pipe(
        Effect.catchTag("EvolutionDecisionsNotEnabledError", () => Effect.succeed([])),
      )

      const accepted = proposals.filter((p) => p.status === "ACCEPTED")
      const rejected = proposals.filter((p) => p.status === "REJECTED")

      const totalProposals = proposals.length > 0 ? proposals.length : null
      const acceptanceRate = proposals.length > 0 ? accepted.length / proposals.length : null
      const proposalChurn = proposals.length > 0 ? rejected.length / proposals.length : null
      const totalReconciliations = logs.length > 0 ? logs.length : null

      const acceptanceTimes = accepted
        .map((p) => (p.acceptedAt != null ? p.acceptedAt - p.createdAt : null))
        .filter((t): t is number => t !== null)
      const avgTimeToAcceptance = acceptanceTimes.length > 0
        ? acceptanceTimes.reduce((a, b) => a + b, 0) / acceptanceTimes.length
        : null

      const confidenceScores = logs.flatMap((l) => l.candidates.map((c) => c.confidenceScore))
      const avgConfidenceScore = confidenceScores.length > 0
        ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
        : null

      const participantCounts = logs.map((l) => l.participants.length)
      const avgParticipantsPerReconciliation = participantCounts.length > 0
        ? participantCounts.reduce((a, b) => a + b, 0) / participantCounts.length
        : null

      const rejectionCodeFrequency: Record<string, number> = {}
      for (const p of rejected) {
        const code = p.rejectionReason ?? "UNKNOWN"
        rejectionCodeFrequency[code] = (rejectionCodeFrequency[code] ?? 0) + 1
      }

      const reconciliationOutcomeCounts = logs.length > 0
        ? {
            submitted: logs.filter((l) => l.outcome === "PROPOSAL_SUBMITTED").length,
            belowThreshold: logs.filter((l) => l.outcome === "BELOW_THRESHOLD").length,
            noCandidates: logs.filter((l) => l.outcome === "NO_CANDIDATES").length,
          }
        : null

      const advisorActivityMap = new Map<string, { agentId: string; executionCount: number; contributionType: string }>()
      for (const l of logs) {
        for (const p of l.participants) {
          const key = `${p.agentId}::${p.contributionType}`
          const existing = advisorActivityMap.get(key)
          if (existing) {
            existing.executionCount++
          } else {
            advisorActivityMap.set(key, { agentId: p.agentId, contributionType: p.contributionType, executionCount: 1 })
          }
        }
      }
      const advisorActivity = advisorActivityMap.size > 0 ? [...advisorActivityMap.values()] : null

      return {
        totalProposals,
        acceptanceRate,
        avgTimeToAcceptance,
        proposalChurn,
        totalReconciliations,
        avgConfidenceScore,
        avgParticipantsPerReconciliation,
        budgetUtilization: null,
        diversityIndex: null,
        rejectionCodeFrequency: proposals.length > 0 ? rejectionCodeFrequency : null,
        reconciliationOutcomeCounts,
        advisorActivity,
      }
    })

    return Service.of({ snapshot })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Evolution.defaultLayer),
)

export * as MetricsService from "./metrics"
