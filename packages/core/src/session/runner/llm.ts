export * as SessionRunnerLLM from "./llm"

import { LLMClient, LLMError, LLMEvent, isContextOverflowFailure, type ProviderErrorEvent, type ToolCall } from "@opencode-ai/ai"
import { Cause, Data, Effect, Exit, Fiber, FiberSet, Layer, Option, Pull, Schedule, Semaphore, Stream } from "effect"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { PermissionV2 } from "../../permission"
import { QuestionTool } from "../../tool/question"
import { ToolOutputStore } from "../../tool-output-store"
import { InstructionState } from "../instruction-state"
import { SessionCompaction } from "../compaction"
import { SessionContext } from "../context"
import { SessionEvent } from "../event"
import { SessionPending } from "../pending"
import { SessionModelRequest } from "../model-request"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionTitle } from "../title"
import { Service } from "./index"
import { createLLMEventPublisher } from "./publish-llm-event"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { StepFailedError } from "../error"
import { toSessionError } from "../to-session-error"
import { SessionRunnerRetry } from "./retry"
import { SessionUsage } from "../usage"

/** How one model call ended: settled, awaiting a scheduled retry, or restarted by compaction. */
type CallOutcome = Data.TaggedEnum<{
  Completed: { readonly needsContinuation: boolean; readonly step: number }
  Retry: { readonly step: number }
  Restart: { readonly step: number; readonly recoveredOverflow: boolean }
}>
const CallOutcome = Data.taggedEnum<CallOutcome>()

// Declining an interactive prompt halts the drain instead of becoming model-facing tool output.
const isUserDeclined = (cause: Cause.Cause<unknown>) =>
  cause.reasons.some(
    (reason) =>
      Cause.isDieReason(reason) &&
      (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionTool.CancelledError),
  )

/**
 * Classifies how the owned tool fibers ended. Interrupts and interactive declines abort
 * the step; a defect from a tool implementation becomes a failed tool call the model can
 * read; a typed infrastructure failure must fail the assistant and then the drain.
 */
const classifyToolExits = (settled: Exit.Exit<Array<Exit.Exit<void, ToolOutputStore.Error>>, never>) => {
  const causes =
    settled._tag === "Failure"
      ? [settled.cause]
      : settled.value.flatMap((exit) => (exit._tag === "Failure" ? [exit.cause] : []))
  const failure = causes.find((cause) => !Cause.hasInterrupts(cause) && !isUserDeclined(cause))
  return {
    interrupted: causes.some(Cause.hasInterrupts),
    declined: causes.some(isUserDeclined),
    failure,
    infraError: failure === undefined ? undefined : Option.getOrUndefined(Cause.findErrorOption(failure)),
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const modelRequests = yield* SessionModelRequest.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const title = yield* SessionTitle.Service
    // Title generation is a side effect of the first step; it must not delay step continuation.
    // Tracked per process so repeated wakes before the second user message arrives don't
    // re-fire a redundant LLM call; `SessionTitle` itself is idempotent based on durable history.
    const titleStarted = new Set<SessionSchema.ID>()
    const forkTitle = yield* FiberSet.makeRuntime<never, void, never>()
    /**
     * Drains eligible manual compaction and user input until the Session becomes idle.
     * Execution lifecycle is published per busy period by SessionExecution, not here.
     */
    const drain = Effect.fn("SessionRunner.drain")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      if (!input.force && !(yield* SessionPending.has(db, input.sessionID, "any"))) return
      yield* settleStaleToolCalls(input.sessionID)
      yield* runPendingCompaction(input.sessionID)
      if (!input.force && !(yield* SessionPending.has(db, input.sessionID, "input"))) return
      do {
        yield* runSteps(input.sessionID)
      } while (yield* SessionPending.has(db, input.sessionID, "input"))
    })

    /**
     * Runs logical steps until no tool result or newly admitted steer requires another
     * model call. Queued inputs remain pending until the current model work reaches idle.
     */
    const runSteps = Effect.fn("SessionRunner.runSteps")(function* (sessionID: SessionSchema.ID) {
      // Fresh work may promote queued input; later steps absorb steers only.
      let promotable: SessionPending.Promotable = "input"
      let step = 1
      while (true) {
        const result = yield* runStep(sessionID, promotable, step)
        yield* startTitleOnce(sessionID)
        yield* runPendingCompaction(sessionID)
        if (!result.needsContinuation && !(yield* SessionPending.has(db, sessionID, "steer"))) return
        promotable = "steer"
        step = result.step + 1
      }
    })

    /** Completes one logical model step, transparently retrying or rebuilding after compaction. */
    const runStep = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      promotable: SessionPending.Promotable,
      step: number,
    ) {
      // Minting message identity before any attempt lets retries resume the same durable
      // message. A compaction restart re-mints: the old message is stranded behind the new
      // compaction boundary, so the rebuilt step needs identity inside the new epoch.
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* Schedule.toStepWithSleep(
        SessionRunnerRetry.schedule(events, sessionID, () => assistantMessageID),
      )
      /**
       * Consumes one retry allowance: sleeps the scheduled backoff, or publishes
       * Step.Failed and fails once attempts are exhausted. The step loop performs
       * the retry itself on the next iteration.
       */
      const waitForRetry = (failure: SessionRunnerRetry.RetryableFailure) =>
        retry(failure).pipe(
          Effect.as(CallOutcome.Retry({ step: failure.step })),
          Pull.catchDone(() =>
            events
              .publish(SessionEvent.Step.Failed, {
                sessionID,
                assistantMessageID,
                error: failure.error,
              })
              .pipe(Effect.andThen(Effect.fail(failure.cause))),
          ),
        )
      let currentPromotable: SessionPending.Promotable | undefined = promotable
      let currentStep = step
      // Overflow recovery is one-shot: a call after recovery must not recover another overflow.
      let recoverOverflow = true
      while (true) {
        const outcome = yield* callModel(
          sessionID,
          currentPromotable,
          currentStep,
          recoverOverflow,
          assistantMessageID,
        ).pipe(Effect.catchTag("SessionRunner.RetryableFailure", waitForRetry))
        if (outcome._tag === "Completed") return { needsContinuation: outcome.needsContinuation, step: outcome.step }
        if (outcome._tag === "Restart") {
          if (outcome.recoveredOverflow) recoverOverflow = false
          assistantMessageID = SessionMessage.ID.create()
        }
        // Neither a retry nor a compaction restart re-promotes input.
        currentPromotable = undefined
        currentStep = outcome.step
      }
    })

    /**
     * Prepares and runs at most one model call, executes its local tools, and durably
     * settles the step. Compaction may instead request that the logical step restart.
     */
    const callModel = Effect.fn("SessionRunner.callModel")(function* (
      sessionID: SessionSchema.ID,
      promotable: SessionPending.Promotable | undefined,
      step: number,
      recoverOverflow: boolean,
      assistantMessageID: SessionMessage.ID,
    ) {
      const selected = yield* context.select(sessionID)
      // Establish what the model knows before admitting what the user said, so
      // a blocked first step leaves pending inputs untouched.
      yield* InstructionState.prepare(db, events, selected.instructions, selected.session.id)
      const promoted = promotable ? yield* SessionPending.promote(db, events, selected.session.id, promotable) : 0
      // Promoted input opens a fresh step allowance.
      const currentStep = promoted > 0 ? 1 : step
      const loaded = yield* context.load(selected)
      const { session, agent } = loaded
      const resolved = loaded.model
      const model = resolved.model
      // Make room: history must fit the context window before the call. A pending manual
      // compaction owns this instead; the runner executes it between steps.
      const compactionInput = { session, messages: loaded.messages, model, cost: resolved.cost }
      if (compaction.required(compactionInput) && !(yield* SessionPending.compaction(db, session.id))) {
        const compacted = yield* compaction.compact(compactionInput)
        if (compacted.status === "completed")
          return CallOutcome.Restart({ step: currentStep, recoveredOverflow: false })
        return yield* new StepFailedError({ error: compacted.error })
      }
      const prepared = yield* modelRequests.prepare({
        context: loaded,
        step: currentStep,
      })
      // Every local tool call forked here is owned until it reaches one durable settlement.
      const toolRuns: Array<{ readonly call: ToolCall; readonly fiber: Fiber.Fiber<void, ToolOutputStore.Error> }> = []
      const interruptTools = Effect.suspend(() => Fiber.interruptAll(toolRuns.map((run) => run.fiber)))
      let needsContinuation = false
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        // The selected catalog identity, not model.id: route-level ids are provider API
        // model ids (for example gpt-5.5-fast resolves to api id gpt-5.5).
        model: resolved.ref,
        providerMetadataKey: model.route.providerMetadataKey ?? model.provider,
        snapshot: startSnapshot,
        assistantMessageID,
      })
      const publication = Semaphore.makeUnsafe(1)
      // Durable publishes are serialized so tool fibers and step settlement never interleave
      // mid-event.
      const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>) => publication.withPermit(effect)
      const publish = (event: LLMEvent) => serialized(publisher.publish(event))

      const stepUsage = (settlement: NonNullable<ReturnType<typeof publisher.stepSettlement>>) => ({
        cost: SessionUsage.calculateCost(resolved.cost, settlement.tokens),
        tokens: settlement.tokens,
      })

      const captureStepEnd = Effect.fnUntraced(function* () {
        const snapshot = yield* snapshots.capture()
        const files =
          startSnapshot && snapshot
            ? yield* snapshots
                .files({ from: startSnapshot, to: snapshot })
                .pipe(Effect.catch(() => Effect.succeed(undefined)))
            : undefined
        return { snapshot, files }
      })

      const publishStepEnd = (settlement: NonNullable<ReturnType<typeof publisher.stepSettlement>>) =>
        Effect.gen(function* () {
          const end = yield* captureStepEnd()
          yield* serialized(
            events.publish(SessionEvent.Step.Ended, {
              sessionID: session.id,
              assistantMessageID: yield* publisher.startAssistant(),
              finish: settlement.finish,
              ...stepUsage(settlement),
              ...end,
            }),
          )
        })

      // The stream is defined here but runs inside the settlement mask below: publish each
      // event durably, fork one fiber per local tool call, and hold back a virgin
      // context-overflow provider error so settlement may recover it via compaction.
      let overflowFailure: ProviderErrorEvent | undefined
      const providerStream = llm.stream(prepared.request).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasRetryEvidence()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (LLMEvent.is.toolInputError(event)) {
              if (!prepared.stepLimitReached) needsContinuation = true
              return
            }
            if (event.type !== "tool-call" || event.providerExecuted) return
            // Unavailable calls fail individually through the same execution seam;
            // continuation depends only on remaining Step allowance.
            if (!prepared.stepLimitReached) needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            toolRuns.push({
              call: event,
              fiber: yield* Effect.uninterruptibleMask((restore) =>
                restore(
                  prepared.executeTool({
                    sessionID: session.id,
                    agent: agent.id,
                    messageID: assistantMessageID,
                    call: event,
                    progress: (update) => serialized(publisher.progress(event.id, update)),
                  }),
                ).pipe(
                  Effect.flatMap((execution) => serialized(publisher.toolExecution(event.id, event.name, execution))),
                ),
              ).pipe(Effect.forkScoped),
            })
          }),
        ),
        Effect.ensuring(serialized(publisher.flush())),
      )

      // Settle: only the stream itself is interruptible (restore); every line after it is
      // protected so a started call always reaches one durable outcome.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const streamFailure = Option.getOrUndefined(Exit.findErrorOption(stream))
          // Note: Exit.hasInterrupts is a type guard whose false branch unsoundly narrows
          // away non-interrupt failures, so both interrupt checks stay Cause-based.
          const streamInterrupted = stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)

          // A context overflow before any assistant output is recoverable: compact and
          // restart the step instead of surfacing the provider error.
          if (
            recoverOverflow &&
            !publisher.hasRetryEvidence() &&
            isContextOverflowFailure(overflowFailure ?? streamFailure) &&
            (yield* restore(compaction.compact(compactionInput))).status === "completed"
          )
            return CallOutcome.Restart({ step: currentStep, recoveredOverflow: true })

          // An unrecovered held-back overflow becomes the step's durable provider error. A
          // thrown LLM failure records the assistant failure unless a provider error was
          // already recorded from the stream. Terminal publication waits for owned tools.
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = streamFailure instanceof LLMError ? streamFailure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            const error = toSessionError(llmFailure)
            if (SessionRunnerRetry.isRetryable(llmFailure) && !publisher.hasRetryEvidence()) {
              // RetryScheduled and Step.Failed fold onto an existing assistant message, so
              // Step.Started must be durable before the failure escapes.
              yield* serialized(publisher.startAssistant())
              return yield* new SessionRunnerRetry.RetryableFailure({
                cause: llmFailure,
                error,
                step: currentStep,
              })
            }
            yield* serialized(publisher.failAssistant(error))
          }
          // Provider error events only arrive from the stream, so the flag is final here.
          const providerFailed = publisher.hasProviderError()

          // Settle every owned tool run: await all exits, not just the first failure,
          // before publishing the terminal step event.
          if (streamInterrupted) yield* interruptTools
          const settled = yield* restore(
            Effect.forEach(toolRuns, (run) => Fiber.await(run.fiber), { concurrency: "unbounded" }),
          ).pipe(Effect.exit)
          if (settled._tag === "Failure") yield* interruptTools
          const tools = classifyToolExits(settled)

          if (tools.declined || streamInterrupted || tools.interrupted) {
            yield* serialized(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))
            yield* serialized(publisher.failAssistant({ type: "aborted", message: "Step interrupted" }))
          }
          if (tools.failure !== undefined) {
            const error = toSessionError(tools.infraError ?? Cause.squash(tools.failure))
            yield* serialized(publisher.failUnsettledTools(error))
            if (tools.infraError !== undefined) yield* serialized(publisher.failAssistant(error))
          }

          // Fail unresolved calls before the terminal step event. Local calls have joined, so
          // these sweeps only close calls that could not produce a truthful settlement.
          if (providerFailed)
            yield* serialized(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))
          const resultMissing = {
            type: "tool.result-missing",
            message: "Provider did not return a tool result",
          } as const
          if (llmFailure && !providerFailed) yield* serialized(publisher.failUnsettledTools(resultMissing, "hosted"))
          // A clean stream that still left hosted calls unresolved fails the step itself.
          if (stream._tag === "Success" && !providerFailed) {
            const hostedResultMissing = yield* serialized(publisher.failUnsettledTools(resultMissing, "hosted"))
            if (hostedResultMissing && !publisher.stepSettlement())
              yield* serialized(publisher.failAssistant(resultMissing))
          }

          const stepFailure = publisher.stepFailure()
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !stepFailure) yield* publishStepEnd(stepSettlement)
          if (stepFailure) {
            const end = yield* captureStepEnd()
            yield* serialized(
              publisher.publishStepFailure({
                ...(stepSettlement ? stepUsage(stepSettlement) : {}),
                ...end,
              }),
            )
          }

          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (tools.declined) return yield* Effect.interrupt
          if ((tools.interrupted || tools.infraError !== undefined) && tools.failure)
            return yield* Effect.failCause(tools.failure)
          if (tools.interrupted && settled._tag === "Failure") return yield* Effect.failCause(settled.cause)
          if (stepFailure) return yield* new StepFailedError({ error: stepFailure })
          return CallOutcome.Completed({ needsContinuation, step: currentStep })
        }),
      )
    }, Effect.scoped)

    /** Executes a previously admitted manual compaction request, if one is pending. */
    const runPendingCompaction = Effect.fn("SessionRunner.runPendingCompaction")(function* (
      sessionID: SessionSchema.ID,
    ) {
      const pending = yield* SessionPending.compaction(db, sessionID)
      if (!pending) return
      const session = yield* getSession(sessionID)
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const compacted = yield* restore(
            Effect.gen(function* () {
              return yield* compaction.compactManual({
                session,
                messages: yield* store.context(sessionID),
                inputID: pending.id,
              })
            }),
          ).pipe(Effect.exit)
          if (Exit.isSuccess(compacted)) return
          const unsettled = yield* SessionPending.compaction(db, sessionID)
          if (unsettled)
            yield* events.publish(SessionEvent.Compaction.Failed, {
              sessionID,
              reason: "manual",
              error: Cause.hasInterruptsOnly(compacted.cause)
                ? { type: "aborted", message: "Compaction cancelled" }
                : { type: "compaction.failed", message: Cause.pretty(compacted.cause) },
              inputID: unsettled.id,
            })
          return yield* Effect.failCause(compacted.cause)
        }),
      )
    })

    /** Closes stale tool calls left active by an earlier interrupted drain. */
    const settleStaleToolCalls = Effect.fn("SessionRunner.settleStaleToolCalls")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* store.context(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "streaming" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "aborted", message: `Tool execution interrupted: ${tool.name}` },
            executed: tool.executed === true,
          })
        }
      }
    })

    /** Fires title generation once per process after the first step makes a user message visible. */
    const startTitleOnce = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      if (titleStarted.has(sessionID)) return
      titleStarted.add(sessionID)
      forkTitle(title.generateForFirstPrompt(yield* getSession(sessionID)).pipe(Effect.ignore))
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
    EventV2.node,
    llmClient,
    SessionContext.node,
    SessionModelRequest.node,
    SessionStore.node,
    SessionCompaction.node,
    SessionTitle.node,
    Snapshot.node,
    Database.node,
  ],
})
