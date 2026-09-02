export * as ToolSettlement from "./tool-settlement"

import { Cause, DateTime, Effect, FiberSet, Option } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { SessionSchema } from "../schema"
import { EventV2 } from "../../event"
import { SessionEvent } from "../event"
import { PermissionV2 } from "../../permission"
import { QuestionV2 } from "../../question"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionStore } from "../store"
import { AgentV2 } from "../../agent"
import { SessionMessage } from "../message"
import { ReflectionState } from "./reflection-state"
import { containsHedge } from "./hedge"
import { ToolRegistry } from "../../tool/registry"
import type { ReflectionResult } from "./index"

export const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
  sessionID: SessionSchema.ID,
) {
  const store = yield* SessionStore.Service
  const events = yield* EventV2.Service
  const context = yield* store.context(sessionID)
  for (const message of context) {
    if (message.type !== "assistant") continue
    for (const tool of message.content) {
      if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
      yield* events.publish(SessionEvent.Tool.Failed, {
        sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: message.id,
        callID: tool.id,
        error: { type: "unknown", message: "Tool execution interrupted" },
        provider: {
          executed: tool.provider?.executed === true,
          ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
        },
      })
    }
  }
})

export const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
  Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

export const isUserDeclined = (cause: Cause.Cause<unknown>) =>
  cause.reasons.some(
    (reason) =>
      Cause.isDieReason(reason) &&
      (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
  )

export interface SettleOptions {
  readonly sessionID: SessionSchema.ID
  readonly agentID: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly event: Extract<LLMEvent, { type: "tool-call" }>
  readonly toolMaterialization: ToolRegistry.Materialization
  readonly getWhyLoopBudget: () => number
  readonly decrementWhyLoopBudget: () => void
  readonly setNeedsContinuation: (value: boolean) => void
  readonly publish: (event: LLMEvent, outputPaths?: ReadonlyArray<string>) => Effect.Effect<void>
  readonly getRefreshedHistory: () => Effect.Effect<Option.Option<ReadonlyArray<{ message: SessionMessage.Message }>>>
  readonly lastAssistantText: (entries: ReadonlyArray<{ message: SessionMessage.Message }>) => string
  readonly publishCycle: (loop: "why", sessionID: SessionSchema.ID, gated: boolean, steered: boolean) => Effect.Effect<void>
  readonly whyLoop: (sessionID: SessionSchema.ID) => Effect.Effect<Option.Option<ReflectionResult>>
}

export const settle = (options: SettleOptions) =>
  Effect.uninterruptibleMask((restore) =>
    restore(
      options.toolMaterialization.settle({
        sessionID: options.sessionID,
        agent: options.agentID,
        assistantMessageID: options.assistantMessageID,
        call: options.event,
      }),
    ).pipe(
      Effect.flatMap((settlement) =>
        Effect.gen(function* () {
          yield* options.publish(
            LLMEvent.toolResult({
              id: options.event.id,
              name: options.event.name,
              result: settlement.result,
              output: settlement.output,
            }),
            settlement.outputPaths ?? [],
          )
          if (options.getWhyLoopBudget() <= 0) return
          const refreshed = yield* options.getRefreshedHistory()
          if (Option.isNone(refreshed)) return
          if (!containsHedge(options.lastAssistantText(refreshed.value))) {
            yield* options.publishCycle("why", options.sessionID, true, false)
            return
          }
          options.decrementWhyLoopBudget()
          const whyResult = yield* options.whyLoop(options.sessionID)
          if (Option.isNone(whyResult)) return
          if (whyResult.value.steered) {
            options.setNeedsContinuation(true)
            ReflectionState.clear(options.sessionID)
          } else if (whyResult.value.converged) {
            const prev = ReflectionState.get(options.sessionID)
            ReflectionState.set(options.sessionID, {
              ...prev,
              lastWhyConverged: true,
              directionConfirmed: false,
            })
          }
        }),
      ),
    ),
  )
