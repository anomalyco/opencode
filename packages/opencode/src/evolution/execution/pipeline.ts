import { Context, Effect, Layer, Option, Ref } from "effect"
import type { Decision, AuditEntry, ExecutionDisposition } from "@/evolution/decision/p6-types"
import { isAutoExecutable, explainAutoExecutability } from "@/evolution/governance/approval"
import { Service as AsyncLogger } from "@/evolution/audit/async-logger"

export interface Interface {
  readonly processDecision: (decision: Decision) => Effect.Effect<ExecutionDisposition>
  readonly approveDecision: (decisionId: string) => Effect.Effect<boolean>
  readonly rejectDecision: (decisionId: string) => Effect.Effect<boolean>
  readonly getHumanReviewQueue: Effect.Effect<readonly Decision[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ExecutionPipeline") {}

function logAudit(audit: Option.Option<AsyncLogger.Interface>, entry: AuditEntry) {
  if (Option.isNone(audit)) return Effect.void
  return Effect.ignoreLogged(audit.value.log(entry))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const audit = yield* Effect.serviceOption(AsyncLogger)
    const reviewRef = yield* Ref.make<Decision[]>([])

    const getHumanReviewQueue = Ref.get(reviewRef)

    const processDecision = Effect.fn("Pipeline.processDecision")(function* (decision: Decision) {
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
        return "HELD_FOR_REVIEW"
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
        return "AUTO_EXECUTED"
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
      return "PENDING_APPROVAL"
    })

    const approveDecision = Effect.fn("Pipeline.approveDecision")(function* (decisionId: string) {
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

    const rejectDecision = Effect.fn("Pipeline.rejectDecision")(function* (decisionId: string) {
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

    return Service.of({ processDecision, approveDecision, rejectDecision, getHumanReviewQueue })
  }),
)

export * as ExecutionPipeline from "./pipeline"
