import { Context, Effect, Layer, Option, Ref } from "effect"
import type { Decision, AuditEntry, ExecutionDisposition } from "@/evolution/decision/p6-types"
import { isAutoExecutable, explainAutoExecutability } from "@/evolution/governance/approval"
import { Service as AsyncAuditLogger } from "@/evolution/audit/async-logger"

export interface Interface {
  readonly processDecision: (decision: Decision) => Effect.Effect<ExecutionDisposition>
  readonly approveDecision: (decisionId: string) => Effect.Effect<boolean>
  readonly rejectDecision: (decisionId: string) => Effect.Effect<boolean>
  readonly getHumanReviewQueue: Effect.Effect<readonly Decision[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ExecutionPipeline") {}

function logAudit(audit: Option.Option<any>, entry: AuditEntry) {
  if (Option.isNone(audit)) return Effect.void
  return audit.value.log(entry).pipe(Effect.catchCause(() => Effect.void))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const audit = yield* Effect.serviceOption(AsyncAuditLogger)
    const reviewRef = yield* Ref.make<Decision[]>([])

    const getHumanReviewQueue = Ref.get(reviewRef)

    const processDecision = (decision: Decision) =>
      Effect.gen(function* () {
        if (decision.consensusOutcome !== "UNANIMOUS_APPROVED") {
          yield* Ref.update(reviewRef, (q) => [...q, decision])
          yield* logAudit(audit, {
            decisionId: decision.decisionId,
            category: decision.category,
            outcome: "HELD_FOR_REVIEW",
            executor: "system",
            timestamp: Date.now(),
            reason: `Consensus not achieved — outcome: ${decision.consensusOutcome}`,
            consensusOutcome: decision.consensusOutcome,
          })
          return "HELD_FOR_REVIEW" as ExecutionDisposition
        }

        if (isAutoExecutable(decision)) {
          yield* logAudit(audit, {
            decisionId: decision.decisionId,
            category: decision.category,
            outcome: "AUTO_EXECUTED",
            executor: "system",
            timestamp: Date.now(),
            reason: explainAutoExecutability(decision),
            consensusOutcome: decision.consensusOutcome,
          })
          return "AUTO_EXECUTED" as ExecutionDisposition
        }

        yield* Ref.update(reviewRef, (q) => [...q, decision])
        yield* logAudit(audit, {
          decisionId: decision.decisionId,
          category: decision.category,
          outcome: "PENDING_APPROVAL",
          executor: "system",
          timestamp: Date.now(),
          reason: explainAutoExecutability(decision),
          consensusOutcome: decision.consensusOutcome,
        })
        return "PENDING_APPROVAL" as ExecutionDisposition
      })

    const approveDecision = (decisionId: string) =>
      Effect.gen(function* () {
        const queue = yield* Ref.get(reviewRef)
        const idx = queue.findIndex((d) => d.decisionId === decisionId)
        if (idx === -1) return false
        const decision = queue[idx]!
        yield* Ref.update(reviewRef, (q) => q.filter((d) => d.decisionId !== decisionId))
        yield* logAudit(audit, {
          decisionId,
          category: decision.category,
          outcome: "APPROVED",
          executor: "human",
          timestamp: Date.now(),
          reason: "Human approved",
          consensusOutcome: decision.consensusOutcome,
        })
        return true
      })

    const rejectDecision = (decisionId: string) =>
      Effect.gen(function* () {
        const queue = yield* Ref.get(reviewRef)
        const idx = queue.findIndex((d) => d.decisionId === decisionId)
        if (idx === -1) return false
        const decision = queue[idx]!
        yield* Ref.update(reviewRef, (q) => q.filter((d) => d.decisionId !== decisionId))
        yield* logAudit(audit, {
          decisionId,
          category: decision.category,
          outcome: "REJECTED",
          executor: "human",
          timestamp: Date.now(),
          reason: "Human rejected",
          consensusOutcome: decision.consensusOutcome,
        })
        return true
      })

    return Service.of({ processDecision: processDecision as (decision: Decision) => Effect.Effect<ExecutionDisposition>, approveDecision: approveDecision as (decisionId: string) => Effect.Effect<boolean>, rejectDecision: rejectDecision as (decisionId: string) => Effect.Effect<boolean>, getHumanReviewQueue })
  }),
)

export * as ExecutionPipeline from "./pipeline"
