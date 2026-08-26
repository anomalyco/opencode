export * as SessionRunnerLLM from "./llm.js"

import { Message } from "@opencode-ai/ai"
import { Cause, Config, Effect, Exit, FiberMap, Layer, Pull, Schedule } from "effect"
import { Database } from "../../database/database.js"
import { Bus } from "../../bus.js"
import { InstructionState } from "../instruction-state.js"
import { SessionCompaction } from "../compaction.js"
import { SessionContext } from "../context.js"
import { SessionEvent } from "../event.js"
import { SessionInbox } from "../inbox.js"
import { SessionModelRequest } from "../model-request.js"
import { SessionModelTransport } from "../model-transport.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { SessionTitle } from "../title.js"
import { DrainResult, Service, type Continuation } from "./index.js"
import { Snapshot } from "../../snapshot.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { llmClient } from "../../effect/app-node-platform.js"
import { StepFailedError } from "../error.js"
import { SessionRunnerRetry } from "./retry.js"
import { SessionStep } from "./step.js"
import { ToolOutput } from "../../tool-output.js"
import { PluginSupervisor } from "../../plugin/supervisor.js"
import { PromptCacheDiagnostics } from "../prompt-cache-diagnostics.js"
import { MAX_STEPS_PROMPT } from "./max-steps.js"

const CONTINUE_AFTER_INCOMPLETE_STREAM =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const modelRequests = yield* SessionModelRequest.Service
    const modelTransport = yield* SessionModelTransport.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const plugins = yield* PluginSupervisor.Service
    const title = yield* SessionTitle.Service
    const steps = yield* SessionStep.make
    const diagnostics = yield* Config.boolean("OPENCODE_PROMPT_CACHE_DIAGNOSTICS").pipe(
      Config.withDefault(false),
      Effect.orDie,
    )
    const promptCacheSnapshots = diagnostics ? new Map<string, PromptCacheDiagnostics.Snapshot>() : undefined
    const diagnosePromptCache = Effect.fn("SessionRunner.diagnosePromptCache")(function* (
      sessionID: SessionSchema.ID,
      request: Parameters<typeof PromptCacheDiagnostics.snapshot>[0],
    ) {
      if (!promptCacheSnapshots) return
      const current = PromptCacheDiagnostics.snapshot(request)
      const comparison = PromptCacheDiagnostics.compare(promptCacheSnapshots.get(sessionID), current)
      promptCacheSnapshots.delete(sessionID)
      promptCacheSnapshots.set(sessionID, current)
      const oldest = promptCacheSnapshots.keys().next().value
      if (promptCacheSnapshots.size > 100 && oldest !== undefined) promptCacheSnapshots.delete(oldest)
      yield* Effect.logInfo("prompt cache prefix").pipe(
        Effect.annotateLogs({
          sessionID,
          toolCount: current.tools.length,
          systemParts: current.system.length,
          messageCount: current.messages.length,
          ...comparison,
        }),
      )
    })
    // Title generation starts once input is visible and must not delay model execution.
    const titles = yield* FiberMap.make<SessionSchema.ID, void, never>()

    const drain = Effect.fn("SessionRunner.drain")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
      readonly continuation?: Continuation
      readonly promotable?: SessionInbox.Promotable
    }) {
      let force = input.force
      let continuation = input.continuation
      const promotable = input.promotable ?? "input"
      if (!force && !continuation && !(yield* eligible(input.sessionID, promotable))) return DrainResult.Complete()
      yield* plugins.flush
      yield* settleStaleToolCalls(input.sessionID)
      while (true) {
        // Scope gates input promotion, not a between-step control that is next in line.
        if (yield* runPendingCompaction(input.sessionID, "input")) {
          force = false
          continue
        }
        if (yield* runPendingMove(input.sessionID, "input")) return DrainResult.Moved({})
        if (!force && !continuation && !(yield* SessionInbox.has(db, input.sessionID, promotable)))
          return DrainResult.Complete()
        const result = yield* runSteps(input.sessionID, continuation, promotable)
        if (result._tag === "Moved") return result
        force = false
        continuation = undefined
      }
    })

    const eligible = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, promotable: SessionInbox.Promotable) {
      if (yield* SessionInbox.has(db, sessionID, promotable)) return true
      if (promotable === "input") return false
      const next = yield* SessionInbox.nextPromotable(db, sessionID, "input")
      return next?.type === "compaction" || next?.type === "move"
    })

    /** Queued inputs wait until the current model work reaches idle; later Steps absorb only steers. */
    const runSteps = Effect.fn("SessionRunner.runSteps")(function* (
      sessionID: SessionSchema.ID,
      continuation: Continuation | undefined,
      drainPromotable: SessionInbox.Promotable,
    ) {
      let promotable: SessionInbox.Promotable = continuation ? "steer" : drainPromotable
      let step = continuation?.step ?? 1
      let next = continuation
      let first = true
      while (true) {
        if (yield* runPendingCompaction(sessionID, "steer")) continue
        if (yield* runPendingMove(sessionID, "steer")) return DrainResult.Moved({ continuation: next })
        if (!first && !next && !(yield* SessionInbox.has(db, sessionID, "steer"))) return DrainResult.Complete()
        const result = yield* runStep(sessionID, promotable, step)
        first = false
        promotable = "steer"
        step = result.step + 1
        next = result.needsContinuation ? { step } : undefined
      }
    })

    /** Owns logical Step policy; each attempt owns its streaming, tools, and durable settlement. */
    const runStep = Effect.fn("SessionRunner.runStep")(function* (
      sessionID: SessionSchema.ID,
      promotable: SessionInbox.Promotable,
      step: number,
    ) {
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* Schedule.toStepWithSleep(SessionRunnerRetry.schedule(bus, sessionID))
      let currentPromotable: SessionInbox.Promotable | undefined = promotable
      let currentStep = step
      let recoverOverflow = true
      let recoverContinuation = true
      while (true) {
        const selected = yield* context.select(sessionID)
        // A blocked initial instruction baseline must leave admitted input pending.
        yield* InstructionState.prepare(db, bus, selected.instructions, selected.session.id)
        const promoted = currentPromotable
          ? yield* SessionInbox.promote(db, bus, selected.session.id, currentPromotable)
          : 0
        if (promoted > 0 && !selected.session.parentID && SessionTitle.isUntitled(selected.session))
          yield* FiberMap.run(titles, sessionID, title.generate(sessionID).pipe(Effect.ignore), {
            onlyIfMissing: true,
          })
        currentStep = promoted > 0 ? 1 : currentStep
        currentPromotable = undefined
        const loaded = yield* context.load(selected)
        const compactionInput = { session: loaded.session, messages: loaded.messages, resolved: loaded.model }
        if (compaction.required(compactionInput)) {
          const compacted = yield* compaction.compact(compactionInput)
          if (compacted.status !== "completed") return yield* new StepFailedError({ error: compacted.error })
          assistantMessageID = SessionMessage.ID.create()
          continue
        }
        const stepLimitReached = loaded.agent.info.steps !== undefined && currentStep >= loaded.agent.info.steps
        const transcript = SessionModelRequest.baseTranscript({
          agent: loaded.agent.info,
          model: loaded.model,
          tools: loaded.tools,
          initial: loaded.initial,
          messages: loaded.messages,
        })
        const prepared = yield* modelRequests.prepare({
          scope: { session: loaded.session, agentID: loaded.agent.id, model: loaded.model, tools: loaded.tools },
          transcript: {
            system: transcript.system,
            messages: stepLimitReached
              ? [...transcript.messages, Message.assistant(MAX_STEPS_PROMPT)]
              : transcript.messages,
          },
          // Keep tool definitions on the final Step to preserve the provider's cached prefix.
          toolChoice: stepLimitReached ? "none" : undefined,
          webSocket: "session",
        })
        yield* diagnosePromptCache(sessionID, prepared.request)
        const outcome = yield* steps.attempt({
          sessionID,
          assistantMessageID,
          agent: loaded.agent.id,
          model: loaded.model,
          prepared,
          toolsDisabled: stepLimitReached,
          recoverContinuation,
          recoverOverflow: Effect.suspend(() =>
            recoverOverflow && compaction.enabled()
              ? compaction.compact(compactionInput).pipe(Effect.map((result) => result.status === "completed"))
              : Effect.succeed(false),
          ),
        })
        if (outcome._tag === "Completed") return { needsContinuation: outcome.needsContinuation, step: currentStep }
        if (outcome._tag === "Retry" || outcome._tag === "Continue") {
          yield* retry({ cause: outcome.cause, error: outcome.error, assistantMessageID }).pipe(
            Pull.catchDone(() =>
              Effect.gen(function* () {
                if (outcome._tag === "Retry")
                  yield* bus.publish(SessionEvent.Step.Failed, { sessionID, assistantMessageID, error: outcome.error })
                return yield* outcome.cause
              }),
            ),
          )
          if (outcome._tag === "Continue") {
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_INCOMPLETE_STREAM })
            assistantMessageID = SessionMessage.ID.create()
          }
          continue
        }
        if (outcome._tag === "Compacted") {
          recoverOverflow = false
          assistantMessageID = SessionMessage.ID.create()
          continue
        }
        recoverContinuation = false
      }
    })

    const runPendingCompaction = Effect.fn("SessionRunner.runPendingCompaction")(function* (
      sessionID: SessionSchema.ID,
      promotable: SessionInbox.Promotable,
    ) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const pending = yield* SessionInbox.serialized(
            sessionID,
            Effect.gen(function* () {
              const selected = yield* SessionInbox.nextPromotable(db, sessionID, promotable)
              if (selected?.type !== "compaction") return
              yield* bus.publishAll([
                [SessionEvent.InboxDelivered, { sessionID, inboxID: selected.id }],
                [SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "", inputID: selected.id }],
              ])
              return selected
            }),
          )
          if (pending?.type !== "compaction") return false
          const session = yield* getSession(sessionID)
          const compacted = yield* restore(
            Effect.gen(function* () {
              return yield* compaction.compactManual({
                session,
                messages: yield* store.context(sessionID),
                inputID: pending.id,
                started: true,
              })
            }),
          ).pipe(Effect.exit)
          if (Exit.isSuccess(compacted)) return true
          yield* bus.publish(SessionEvent.Compaction.Failed, {
            sessionID,
            reason: "manual",
            error: Cause.hasInterruptsOnly(compacted.cause)
              ? { type: "aborted", message: "Compaction cancelled" }
              : { type: "compaction.failed", message: Cause.pretty(compacted.cause) },
            inputID: pending.id,
          })
          return yield* Effect.failCause(compacted.cause)
        }),
      )
    })

    const runPendingMove = Effect.fn("SessionRunner.runPendingMove")(function* (
      sessionID: SessionSchema.ID,
      promotable: SessionInbox.Promotable,
    ) {
      return yield* SessionInbox.serialized(
        sessionID,
        Effect.gen(function* () {
          const pending = yield* SessionInbox.nextPromotable(db, sessionID, promotable)
          if (pending?.type !== "move") return false
          yield* modelTransport.close(sessionID)
          yield* bus.publishAll([
            [SessionEvent.InboxDelivered, { sessionID, inboxID: pending.id }],
            [
              SessionEvent.Moved,
              {
                sessionID,
                location: pending.payload.location,
                projectID: pending.payload.projectID,
                subpath: pending.payload.subpath,
              },
            ],
          ])
          return true
        }),
      )
    })

    const settleStaleToolCalls = Effect.fn("SessionRunner.settleStaleToolCalls")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* store.context(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "streaming" && tool.state.status !== "running")) continue
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID: message.id,
            id: tool.id,
            error: { type: "aborted", message: `Tool execution interrupted: ${tool.name}` },
            executed: tool.executed === true,
          })
        }
      }
    })

    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      return session
    })

    return Service.of({ drain })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    llmClient,
    SessionContext.node,
    SessionModelRequest.node,
    SessionModelTransport.node,
    SessionStore.node,
    SessionCompaction.node,
    PluginSupervisor.node,
    SessionTitle.node,
    Snapshot.node,
    ToolOutput.node,
    Database.node,
  ],
})
