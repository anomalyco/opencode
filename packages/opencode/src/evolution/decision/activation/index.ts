import { Duration, Effect, Option, Ref, Schema } from "effect"
import { Evolution } from "@/evolution/index"
import { EvolutionDecisionEngine } from "@/evolution/decision/engine"
import { ExecutionPipeline } from "@/evolution/execution/pipeline"
import { DecisionBridge } from "@/evolution/execution/bridge"
import { Service as AsyncAuditLogger } from "@/evolution/audit/async-logger"
import { ContextComposer } from "@/evolution/context"
import { REGISTERED_AGENTS } from "@/evolution/decision/agents/register"
import { Service as WorkerPool } from "@/evolution/orchestration/worker-pool"
import { ReconciliationLogSchema, type ParticipantEntry, type ReconciliationLog } from "@/evolution/decision/reconciliation-log"
import { makeActivationDefaults } from "./defaults"
import type { ExecutionDisposition } from "@/evolution/decision/p6-types"

export class ActivationBusyError extends Schema.TaggedErrorClass<ActivationBusyError>()("EvolutionActivationBusyError", {
  message: Schema.String,
}) {}

export class ActivationError extends Schema.TaggedErrorClass<ActivationError>()("EvolutionActivationError", {
  message: Schema.String,
}) {}

const inFlightRef = Ref.makeUnsafe(false)

export const invoke = Effect.fn("Activation.invoke")(function* (
  overrides?: { instruction?: string; tags?: readonly string[]; dryRun?: boolean },
) {
  const busy = yield* Ref.get(inFlightRef)
  if (busy) return yield* Effect.fail(new ActivationBusyError({ message: "Already in-flight" }))

  yield* Ref.set(inFlightRef, true)

  const evolutionOpt = yield* Effect.serviceOption(Evolution.Service)
  const engineOpt = yield* Effect.serviceOption(EvolutionDecisionEngine.Service)

  if (Option.isNone(evolutionOpt)) {
    return yield* Effect.fail(new ActivationError({ message: "Evolution.Service not available" }))
    }
    if (Option.isNone(engineOpt)) {
      return yield* Effect.fail(new ActivationError({ message: "EvolutionDecisionEngine.Service not available" }))
  }

  const evolution = evolutionOpt.value
  const engine = engineOpt.value
  const auditLoggerOpt = yield* Effect.serviceOption(AsyncAuditLogger)
  const pipeline = yield* ExecutionPipeline.Service
  const config = yield* evolution.getConfig()

  const defaults = makeActivationDefaults(overrides)
  const composer = ContextComposer.make(evolution, config)
  const context = yield* composer.provide()

  const input = {
    agents: REGISTERED_AGENTS,
    context,
    criteria: defaults.criteria,
    decisionCriteria: defaults.decisionCriteria,
    minCandidateConfidence: config.minCandidateConfidence ?? 0.3,
    dryRun: overrides?.dryRun ?? false,
  }

  // Dual-gate: worker pool semaphore (max 5) + inFlightRef (coarse lock)
  const poolOpt = yield* Effect.serviceOption(WorkerPool)
  if (Option.isSome(poolOpt)) {
    const poolState = yield* poolOpt.value.getPoolState
    if (poolState.active >= poolState.maxWorkers) {
      return yield* Effect.fail(new ActivationBusyError({ message: "Worker pool at capacity" }))
    }
  }

  const disposition = yield* (Effect.gen(function* () {
    const output = yield* engine.reconcile(input).pipe(
      Effect.timeout(Duration.seconds(60)),
      Effect.catch((e) => Effect.fail(new ActivationError({ message: `Engine error: ${e}` }))),
    )

    // Bridge: convert raw engine output to pipeline-ready Decision or NO_ACTION
    const bridgeResult = yield* DecisionBridge.reconcileToDecision(output).pipe(
      Effect.catch((e) => Effect.fail(new ActivationError({ message: e.message }))),
    )

    // Handle NO_ACTION outcomes (BELOW_THRESHOLD, NO_CANDIDATES)
    if (bridgeResult.type === "NO_ACTION") {
      return "HELD_FOR_REVIEW" as ExecutionDisposition
    }

    // DECISION_READY — process through pipeline (validates, audits, routes)
    const disposition = yield* pipeline.processDecision(bridgeResult.decision)

    // AC-17: save reconciliation log AFTER pipeline disposition, BEFORE submit
    if (output.reconciliationLog) {
      const participants = output.reconciliationLog.participants.map((p) => ({
        ...p,
        capabilities: [...p.capabilities],
      } as ParticipantEntry))
      const encoded = Schema.decodeUnknownSync(ReconciliationLogSchema)({
        ...output.reconciliationLog,
        participants,
      }) as ReconciliationLog
      yield* evolution.decisions().saveReconciliationLog(encoded).pipe(
        Effect.catch(() => Effect.logWarning("Activation: saveReconciliationLog failed")),
      )
    }

    // If auto-executable: submit to proposal store
    if (disposition === "AUTO_EXECUTED" && output.proposedAction && output.rationale) {
      const submitResult = yield* evolution.decisions().submit({
        key: output.reconciliationLog?.sessionId ?? "",
        title: output.proposedAction,
        context: output.rationale,
        proposedDecision: output.proposedAction,
        consequences: output.rationale,
        tags: output.tags ?? [],
        origin: { proposerId: output.selectedAgentId ?? "decision-engine" },
      }).pipe(
        Effect.catch(() => Effect.logWarning("Activation: submit failed")),
      )

      if (submitResult && output.reconciliationLog) {
        const updatedLog = {
          ...output.reconciliationLog,
          proposalId: submitResult.id,
          submissionStatus: "SUBMITTED" as const,
        }
        const participants = updatedLog.participants.map((p) => ({
          ...p,
          capabilities: [...p.capabilities],
        } as ParticipantEntry))
        const encoded = Schema.decodeUnknownSync(ReconciliationLogSchema)({
          ...updatedLog,
          participants,
        }) as ReconciliationLog
        yield* evolution.decisions().saveReconciliationLog(encoded).pipe(
          Effect.catch(() => Effect.logWarning("Activation: log update after submit failed")),
        )
      }
    }

    return disposition
  })).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Ref.set(inFlightRef, false)
        if (Option.isSome(poolOpt)) {
          yield* poolOpt.value.resetPool
        }
      }),
    ),
  )
  return disposition
})

export * as Activation from "."
