export * as SessionRunnerLLM from "./llm"

import { LLMClient, LLMError, LLMEvent, isContextOverflowFailure, type ProviderErrorEvent } from "@opencode-ai/ai"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Cause, Effect, Exit, Fiber, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
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
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { StepFailedError } from "../error"
import { toSessionError } from "../to-session-error"
import { SessionRunnerRetry } from "./retry"
import { SessionUsage } from "../usage"

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
    const titleAttempted = new Set<SessionSchema.ID>()
    const forkTitle = yield* FiberSet.makeRuntime<never, void, never>()
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      return session
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
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

    // Declining an interactive prompt halts the drain instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionTool.CancelledError),
      )

    const attemptStep = Effect.fn("SessionRunner.attemptStep")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionPending.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compact,
      assistantMessageID?: SessionMessage.ID,
    ) {
      const selected = yield* context.select(sessionID)
      // Establish what the model knows before admitting what the user said, so
      // a blocked first step leaves pending inputs untouched.
      yield* InstructionState.prepare(db, events, selected.instructions, selected.session.id)
      let currentStep = step
      if (promotion) {
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionPending.promoteSteers(db, events, selected.session.id)
        if (promotion === "queue") {
          promoted += Number(yield* SessionPending.promoteNextQueued(db, events, selected.session.id))
          promoted += yield* SessionPending.promoteSteers(db, events, selected.session.id)
        }
        if (promoted > 0) currentStep = 1
      }
      const loaded = yield* context.load(selected)
      const session = loaded.session
      const agent = loaded.agent
      const resolved = loaded.model
      const model = resolved.model
      const compactionInput = { session, messages: loaded.messages, model, cost: resolved.cost }
      if (compaction.required(compactionInput) && !(yield* SessionPending.compaction(db, session.id))) {
        const compacted = yield* compaction.compact(compactionInput)
        if (compacted.status === "completed") return { _tag: "RestartAfterCompaction", step: currentStep } as const
        return yield* new StepFailedError({ error: compacted.error })
      }
      const prepared = yield* modelRequests.prepare({
        context: loaded,
        step: currentStep,
      })
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      const ownedToolFibers: Array<Fiber.Fiber<void, ToolOutputStore.Error>> = []
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
      const publish = (event: LLMEvent, error?: SessionError.Error) => serialized(publisher.publish(event, error))
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
              if (prepared.resolveToolCall(event.name).type === "settle") needsContinuation = true
              return
            }
            if (event.type !== "tool-call" || event.providerExecuted) return
            const tool = prepared.resolveToolCall(event.name)
            if (tool.type === "reject") {
              yield* serialized(publisher.failUnsettledTools(tool.error))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            ownedToolFibers.push(
              yield* Effect.uninterruptibleMask((restore) =>
                restore(
                  tool.settle({
                    sessionID: session.id,
                    agent: agent.id,
                    messageID: assistantMessageID,
                    call: event,
                    progress: (update) =>
                      serialized(
                        events.publish(SessionEvent.Tool.Progress, {
                          sessionID: session.id,
                          assistantMessageID,
                          callID: event.id,
                          structured: { ...update.structured },
                          content: [...update.content],
                        }),
                      ),
                  }),
                ).pipe(
                  Effect.flatMap((settlement) =>
                    publish(
                      LLMEvent.toolResult({
                        id: event.id,
                        name: event.name,
                        result: settlement.result,
                        output: settlement.output,
                      }),
                      settlement.error,
                    ),
                  ),
                ),
              ).pipe(FiberSet.run(toolFibers)),
            )
          }),
        ),
        Effect.ensuring(serialized(publisher.flush())),
      )

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

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          // Gather the evidence: how did the provider stream end?
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
            (yield* restore(recoverOverflow({ session, messages: loaded.messages, model, cost: resolved.cost })))
              .status === "completed"
          )
            return { _tag: "RestartAfterOverflowCompaction", step: currentStep } as const

          // An unrecovered held-back overflow becomes the step's durable provider error. A
          // thrown LLM failure records the assistant failure unless a provider error was
          // already recorded from the stream. Terminal publication waits for owned tools.
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = streamFailure instanceof LLMError ? streamFailure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            const error = toSessionError(llmFailure)
            if (SessionRunnerRetry.isRetryable(llmFailure) && !publisher.hasRetryEvidence()) {
              return yield* new SessionRunnerRetry.RetryableFailure({
                cause: llmFailure,
                assistantMessageID: yield* publisher.startAssistant(),
                error,
                step: currentStep,
              })
            }
            yield* serialized(publisher.failAssistant(error))
          }
          // Provider error events only arrive from the stream, so the flag is final here.
          const providerFailed = publisher.hasProviderError()

          // Settle every owned tool fiber. FiberSet.join returns on the first failure, so retain
          // the individual fibers and await all exits before publishing the terminal step event.
          if (streamInterrupted) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(
            Effect.forEach(ownedToolFibers, Fiber.await, { concurrency: "unbounded" }),
          ).pipe(Effect.exit)
          const settledCauses =
            settled._tag === "Failure"
              ? [settled.cause]
              : settled.value.flatMap((exit) => (exit._tag === "Failure" ? [exit.cause] : []))
          const toolsInterrupted = settledCauses.some(Cause.hasInterrupts)
          const userDeclined = settledCauses.some(isUserDeclined)

          if (settled._tag === "Failure") yield* FiberSet.clear(toolFibers)
          if (userDeclined || streamInterrupted || toolsInterrupted) {
            yield* serialized(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))
            yield* serialized(publisher.failAssistant({ type: "aborted", message: "Step interrupted" }))
          }
          // A settled tool fiber failure is one of two things. A defect from a tool
          // implementation becomes a failed tool call the model can read, and the step still
          // settles so the model may recover. A typed infrastructure failure (tool output
          // could not be persisted) also fails the assistant and then fails the drain.
          const settledFailure = settledCauses.find((cause) => !Cause.hasInterrupts(cause) && !isUserDeclined(cause))
          const infraError =
            settledFailure === undefined ? undefined : Option.getOrUndefined(Cause.findErrorOption(settledFailure))
          if (settledFailure !== undefined) {
            const failure = infraError ?? Cause.squash(settledFailure)
            const error = toSessionError(failure)
            yield* serialized(publisher.failUnsettledTools(error))
            if (infraError !== undefined) yield* serialized(publisher.failAssistant(error))
          }

          // Fail unresolved calls before the terminal step event. Local calls have joined, so
          // these sweeps only close calls that could not produce a truthful settlement.
          if (providerFailed)
            yield* serialized(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))
          if (llmFailure && !providerFailed)
            yield* serialized(
              publisher.failUnsettledTools(
                {
                  type: "tool.result-missing",
                  message: "Provider did not return a tool result",
                },
                true,
              ),
            )
          const hostedResultMissing =
            stream._tag === "Success" && !providerFailed
              ? yield* serialized(
                  publisher.failUnsettledTools(
                    { type: "tool.result-missing", message: "Provider did not return a tool result" },
                    true,
                  ),
                )
              : false
          if (hostedResultMissing && !publisher.stepSettlement())
            yield* serialized(
              publisher.failAssistant({
                type: "tool.result-missing",
                message: "Provider did not return a tool result",
              }),
            )

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
          if (userDeclined) return yield* Effect.interrupt
          if ((toolsInterrupted || infraError !== undefined) && settledFailure)
            return yield* Effect.failCause(settledFailure)
          if (toolsInterrupted && settled._tag === "Failure") return yield* Effect.failCause(settled.cause)
          if (stepFailure) return yield* new StepFailedError({ error: stepFailure })
          return {
            _tag: "Completed",
            needsContinuation,
            step: currentStep,
          } as const
        }),
      )
    }, Effect.scoped)

    const runStep = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionPending.Delivery | undefined,
      step: number,
    ) {
      // Compaction restarts rebuild the request from compacted history without re-promoting.
      // Overflow recovery is one-shot: a post-compaction attempt must not recover another
      // overflow, so the recovery hook is dropped after it fires.
      let recoverOverflow: typeof compaction.compact | undefined = compaction.compact
      let currentPromotion = promotion
      let currentStep = step
      let assistantMessageID: SessionMessage.ID | undefined
      while (true) {
        const attempt = yield* Effect.suspend(() =>
          attemptStep(sessionID, currentPromotion, currentStep, recoverOverflow, assistantMessageID),
        ).pipe(
          Effect.tapError((error) =>
            error instanceof SessionRunnerRetry.RetryableFailure
              ? Effect.sync(() => {
                  currentStep = error.step
                  assistantMessageID = error.assistantMessageID
                  currentPromotion = undefined
                })
              : Effect.void,
          ),
          Effect.retryOrElse(SessionRunnerRetry.schedule(events, sessionID), (error) => {
            if (!(error instanceof SessionRunnerRetry.RetryableFailure)) return Effect.fail(error)
            return events
              .publish(SessionEvent.Step.Failed, {
                sessionID,
                assistantMessageID: error.assistantMessageID,
                error: error.error,
              })
              .pipe(Effect.andThen(Effect.fail(error.cause)))
          }),
        )
        if (attempt._tag === "Completed")
          return {
            needsContinuation: attempt.needsContinuation,
            step: attempt.step,
          }
        if (attempt._tag === "RestartAfterOverflowCompaction") recoverOverflow = undefined
        yield* Effect.yieldNow
        currentPromotion = undefined
        currentStep = attempt.step
      }
    })

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
          if (Exit.isFailure(compacted)) {
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
          }
        }),
      )
    })

    // Execution lifecycle is published per busy period by SessionExecution, not per drain here.
    const drain = Effect.fn("SessionRunner.drain")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      yield* runPendingCompaction(input.sessionID)
      const hasSteer = yield* SessionPending.has(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionPending.has(db, input.sessionID, "queue")
      if (!input.force && !hasSteer && !hasQueue) return
      yield* failInterruptedTools(input.sessionID)
      let promotion: SessionPending.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        // Repeat steps while continuation is needed. A step needs continuation only
        // when it recorded local tool calls whose results the model has not yet seen;
        // a provider error suppresses it. Pending steers also continue the loop so
        // interjections are answered before the session goes idle.
        while (needsContinuation) {
          const result = yield* runStep(input.sessionID, promotion, step)
          // Steer/queue promotion inside runStep has already made the pending input a visible
          // user message by this point, so the first-user-message check below is reliable.
          if (!titleAttempted.has(input.sessionID)) {
            titleAttempted.add(input.sessionID)
            forkTitle(title.generateForFirstPrompt(yield* getSession(input.sessionID)).pipe(Effect.ignore))
          }
          needsContinuation = result.needsContinuation
          step = result.step + 1
          if (needsContinuation) {
            yield* runPendingCompaction(input.sessionID)
            promotion = "steer"
            continue
          }
          yield* runPendingCompaction(input.sessionID)
          promotion = "steer"
          needsContinuation = yield* SessionPending.has(db, input.sessionID, "steer")
        }
        yield* runPendingCompaction(input.sessionID)
        const hasSteer = yield* SessionPending.has(db, input.sessionID, "steer")
        const hasQueue = hasSteer ? false : yield* SessionPending.has(db, input.sessionID, "queue")
        shouldRun = hasSteer || hasQueue
        promotion = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      }
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
