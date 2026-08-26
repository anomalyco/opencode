export * as SessionRunnerLLM from "./llm.js"

import {
  LLMClient,
  AIError,
  InvalidProviderOutputReason,
  LLMEvent,
  Message,
  isContextOverflowFailure,
  type ProviderErrorEvent,
  type ToolCall,
} from "@opencode-ai/ai"
import path from "path"
import { Cause, Config, Data, Effect, Exit, Fiber, FiberMap, Layer, Option, Pull, Schedule, Stream } from "effect"
import { Database } from "../../database/database.js"
import { Bus } from "../../bus.js"
import { Permission } from "../../permission.js"
import { Project } from "../../project.js"
import { RelativePath } from "../../schema.js"
import { QuestionTool } from "../../tool/plugin/question.js"
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
import { Service, type Continuation } from "./index.js"
import { createLLMEventPublisher, type StepRecord } from "./publish-llm-event.js"
import { Snapshot } from "../../snapshot.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { llmClient } from "../../effect/app-node-platform.js"
import { StepFailedError } from "../error.js"
import { toSessionError } from "../to-session-error.js"
import { SessionRunnerRetry } from "./retry.js"
import { SessionUsage } from "../usage.js"
import { ToolOutput } from "../../tool-output.js"
import { PluginSupervisor } from "../../plugin/supervisor.js"
import { Tool } from "../../tool.js"
import { PromptCacheDiagnostics } from "../prompt-cache-diagnostics.js"
import { MAX_STEPS_PROMPT } from "./max-steps.js"

/** How one model call ended: settled, awaiting retry/recovery, or restarted by compaction. */
type CallOutcome = Data.TaggedEnum<{
  Completed: { readonly needsContinuation: boolean; readonly step: number }
  Retry: { readonly step: number }
  Continue: {
    readonly cause: AIError
    readonly error: SessionRunnerRetry.RetryableFailure["error"]
    readonly step: number
  }
  RecoverFull: { readonly step: number }
  Restart: { readonly step: number; readonly recoveredOverflow: boolean }
}>
const CallOutcome = Data.taggedEnum<CallOutcome>()

// Declining an interactive prompt halts the drain instead of becoming model-facing tool output.
const isDecline = (
  error: SessionModelRequest.ExecuteError,
): error is Permission.DeclinedError | QuestionTool.CancelledError =>
  error._tag === "Permission.DeclinedError" || error._tag === "QuestionTool.CancelledError"

const isInterruptedStream = (failure: AIError) => {
  if (failure.reason._tag === "InvalidProviderOutput")
    return failure.reason.classification === "incomplete-stream"
  if (failure.reason._tag === "Transport") return failure.reason.operation === "read"
  return false
}

/**
 * Classifies how the owned tool fibers ended. Interrupts abort the step; a user decline
 * settles its own call and then aborts the step; a defect from a tool implementation
 * becomes a failed tool call the model can read; a typed infrastructure failure must
 * fail the assistant and then the drain.
 */
const classifyToolExits = (
  settled: Exit.Exit<Array<Exit.Exit<void, SessionModelRequest.ExecuteError>>, never>,
  calls: ReadonlyArray<ToolCall>,
) => {
  // Exits align with calls by construction: one owned fiber per accepted local call.
  const exits = settled._tag === "Success" ? settled.value : []
  const declines = exits.flatMap((exit, index) =>
    exit._tag === "Failure"
      ? exit.cause.reasons.flatMap((reason) =>
          Cause.isFailReason(reason) && isDecline(reason.error) ? [{ call: calls[index], reason: reason.error }] : [],
        )
      : [],
  )
  const causes =
    settled._tag === "Failure"
      ? [settled.cause]
      : exits.flatMap((exit) => (exit._tag === "Failure" ? [exit.cause] : []))
  // The first non-interrupt, non-decline failure, rebuilt without decline reasons so the
  // drain's error channel never carries a decline.
  const failure = causes
    .flatMap((cause) => {
      if (Cause.hasInterrupts(cause)) return []
      const reasons = cause.reasons.flatMap(
        (reason): Array<Cause.Reason<never>> =>
          Cause.isFailReason(reason)
            ? isDecline(reason.error)
              ? []
              : // A typed failure here broke the ExecuteError contract (the per-fiber
                // `catchTag("Tool.Error")` consumes honest ones). Surfacing it as a defect
                // keeps it from being dropped, which would leave its call unsettled forever.
                [Cause.makeDieReason(reason.error)]
            : [reason],
      )
      return reasons.length > 0 ? [Cause.fromReasons(reasons)] : []
    })
    .at(0)
  return {
    interrupted: causes.some(Cause.hasInterrupts),
    declines,
    failure,
  }
}

const TOOLS_INTERRUPTED = { type: "aborted", message: "Tool execution interrupted" } as const
const STEP_INTERRUPTED = { type: "aborted", message: "Step interrupted" } as const
const RESULT_MISSING = { type: "tool.result-missing", message: "Provider did not return a tool result" } as const
const CONTINUE_AFTER_INCOMPLETE_STREAM =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const fs = yield* FSUtil.Service
    const projects = yield* Project.Service
    const llm = yield* LLMClient.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const modelRequests = yield* SessionModelRequest.Service
    const modelTransport = yield* SessionModelTransport.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const plugins = yield* PluginSupervisor.Service
    const title = yield* SessionTitle.Service
    const toolOutput = yield* ToolOutput.Service
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
    /**
     * Drains eligible manual compaction and user input until the Session becomes idle.
     * Execution lifecycle is published per busy period by SessionExecution, not here.
     */
    const drain = Effect.fn("SessionRunner.drain")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
      readonly continuation?: Continuation
      readonly promotable?: SessionInbox.Promotable
    }) {
      let force = input.force
      let continuation = input.continuation
      const promotable = input.promotable ?? "input"
      if (!force && !continuation && !(yield* eligible(input.sessionID, promotable)))
        return { type: "complete" as const }
      yield* plugins.flush
      yield* settleStaleToolCalls(input.sessionID)
      while (true) {
        // Between-turn control items run under any drain scope: scope gates which user
        // input may promote, not whether admitted housekeeping runs. Steered control
        // items go ahead of any queued input; only a queue-delivered control item
        // parked behind a queued prompt is not the next eligible item.
        if (yield* runPendingCompaction(input.sessionID, "input")) {
          force = false
          continue
        }
        const moved = yield* runPendingMove(input.sessionID, "input")
        if (moved) return { type: "moved" as const, ...moved }
        if (!force && !continuation && !(yield* SessionInbox.has(db, input.sessionID, promotable)))
          return { type: "complete" as const }
        const result = yield* runSteps(input.sessionID, continuation, promotable)
        if (result.type === "moved") return result
        force = false
        continuation = undefined
      }
    })

    /** Work this drain may perform: scoped input, or a between-turn control item next in line. */
    const eligible = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, promotable: SessionInbox.Promotable) {
      if (yield* SessionInbox.has(db, sessionID, promotable)) return true
      if (promotable === "input") return false
      const next = yield* SessionInbox.nextPromotable(db, sessionID, "input")
      return next?.type === "compaction" || next?.type === "move"
    })

    /**
     * Runs logical steps until no tool result or newly admitted steer requires another
     * model call. Queued inputs remain pending until the current model work reaches idle.
     */
    const runSteps = Effect.fn("SessionRunner.runSteps")(function* (
      sessionID: SessionSchema.ID,
      continuation: Continuation | undefined,
      drainPromotable: SessionInbox.Promotable,
    ) {
      // Fresh work may promote queued input; resumed turns and later steps absorb steers only.
      let promotable: SessionInbox.Promotable = continuation ? "steer" : drainPromotable
      let step = continuation?.step ?? 1
      let next = continuation
      // The drain admitted this work, so the first step always runs — even after a
      // control item consumed at this boundary (unlike drain's one-shot force).
      let first = true
      // Every boundary has the same shape: control items first, then one exit decision,
      // then the model. The turn continues only while the first step, a continuation, or
      // steer input is owed. Deciding after control items means consuming the last
      // steered compaction ends the turn instead of issuing an input-free model call.
      while (true) {
        if (yield* runPendingCompaction(sessionID, "steer")) continue
        const moved = yield* runPendingMove(sessionID, "steer")
        if (moved) return { type: "moved" as const, continuation: next, ...moved }
        if (!first && !next && !(yield* SessionInbox.has(db, sessionID, "steer")))
          return { type: "complete" as const }
        const result = yield* runStep(sessionID, promotable, step)
        first = false
        promotable = "steer"
        step = result.step + 1
        next = result.needsContinuation ? { step } : undefined
      }
    })

    /** Completes one logical model step, transparently retrying or rebuilding after compaction. */
    const runStep = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      promotable: SessionInbox.Promotable,
      step: number,
    ) {
      // Minting message identity before any attempt lets retries resume the same durable
      // message. A compaction restart re-mints: the old message is stranded behind the new
      // compaction boundary, so the rebuilt step needs identity inside the new epoch.
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* Schedule.toStepWithSleep(
        SessionRunnerRetry.schedule(bus, sessionID, () => assistantMessageID),
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
            bus
              .publish(SessionEvent.Step.Failed, {
                sessionID,
                assistantMessageID,
                error: failure.error,
              })
              .pipe(Effect.andThen(Effect.fail(failure.cause))),
          ),
        )
      let currentPromotable: SessionInbox.Promotable | undefined = promotable
      let currentStep = step
      // Overflow recovery is one-shot: a call after recovery must not recover another overflow.
      let recoverOverflow = true
      // Continuation rejection permits one immediate full-context Physical Attempt without generic backoff.
      let recoverContinuation = true
      while (true) {
        const outcome = yield* callModel(
          sessionID,
          currentPromotable,
          currentStep,
          recoverOverflow,
          recoverContinuation,
          assistantMessageID,
        ).pipe(Effect.catchTag("SessionRunner.RetryableFailure", waitForRetry))
        if (outcome._tag === "Completed") return { needsContinuation: outcome.needsContinuation, step: outcome.step }
        if (outcome._tag === "Continue") {
          yield* retry(
            new SessionRunnerRetry.RetryableFailure({
              cause: outcome.cause,
              error: outcome.error,
              step: outcome.step,
            }),
          ).pipe(Pull.catchDone(() => Effect.fail(outcome.cause)))
          yield* bus.publish(SessionEvent.Synthetic, {
            sessionID,
            text: CONTINUE_AFTER_INCOMPLETE_STREAM,
          })
          assistantMessageID = SessionMessage.ID.create()
        }
        if (outcome._tag === "Restart") {
          if (outcome.recoveredOverflow) recoverOverflow = false
          assistantMessageID = SessionMessage.ID.create()
        }
        if (outcome._tag === "RecoverFull") recoverContinuation = false
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
      promotable: SessionInbox.Promotable | undefined,
      step: number,
      recoverOverflow: boolean,
      recoverContinuation: boolean,
      assistantMessageID: SessionMessage.ID,
    ) {
      const selected = yield* context.select(sessionID)
      // Establish what the model knows before admitting what the user said, so
      // a blocked first step leaves pending inputs untouched.
      yield* InstructionState.prepare(db, bus, selected.instructions, selected.session.id)
      const promoted = promotable ? yield* SessionInbox.promote(db, bus, selected.session.id, promotable) : 0
      if (promoted > 0 && !selected.session.parentID && SessionTitle.isUntitled(selected.session))
        yield* FiberMap.run(titles, sessionID, title.generate(sessionID).pipe(Effect.ignore), {
          onlyIfMissing: true,
        })
      // Promoted input opens a fresh step allowance.
      const currentStep = promoted > 0 ? 1 : step
      const loaded = yield* context.load(selected)
      const { session, agent } = loaded
      const resolved = loaded.model
      // Make room: history must fit the context window before the call. A pending manual
      // compaction owns this instead; the runner executes it between steps.
      const compactionInput = { session, messages: loaded.messages, resolved }
      if (compaction.required(compactionInput)) {
        const compacted = yield* compaction.compact(compactionInput)
        if (compacted.status === "completed")
          return CallOutcome.Restart({ step: currentStep, recoveredOverflow: false })
        return yield* new StepFailedError({ error: compacted.error })
      }
      const stepLimitReached = agent.info.steps !== undefined && currentStep >= agent.info.steps
      const transcript = SessionModelRequest.baseTranscript({
        agent: agent.info,
        model: resolved,
        tools: loaded.tools,
        initial: loaded.initial,
        messages: loaded.messages,
      })
      const prepared = yield* modelRequests.prepare({
        scope: { session, agentID: agent.id, model: resolved, tools: loaded.tools },
        transcript: {
          system: transcript.system,
          messages: stepLimitReached
            ? [...transcript.messages, Message.assistant(MAX_STEPS_PROMPT)]
            : transcript.messages,
        },
        // The final Step keeps definitions available to protocols with native "none",
        // preserving their prompt cache prefix. Calls are still rejected at execution.
        toolChoice: stepLimitReached ? "none" : undefined,
        webSocket: "session",
      })
      yield* diagnosePromptCache(session.id, prepared.request)
      const executeTool = (input: Parameters<typeof prepared.executeTool>[0]) => {
        if (stepLimitReached) return new Tool.Error({ message: "Tools are disabled after the maximum agent steps" })
        return prepared.executeTool(input)
      }
      // Every local tool call forked here is owned until it reaches one durable settlement.
      const toolRuns: Array<{
        readonly call: ToolCall
        readonly fiber: Fiber.Fiber<void, SessionModelRequest.ExecuteError>
      }> = []
      const interruptTools = Effect.suspend(() => Fiber.interruptAll(toolRuns.map((run) => run.fiber)))
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(bus, {
        sessionID: session.id,
        agent: agent.id,
        // The selected catalog identity, not model.id: route-level ids are provider API
        // model ids (for example gpt-5.5-fast resolves to api id gpt-5.5).
        model: resolved.ref,
        providerMetadataKey: transcript.providerMetadataKey,
        snapshot: startSnapshot,
        assistantMessageID,
      })
      const stepUsage = (finish: NonNullable<StepRecord["finish"]>) => ({
        cost: SessionUsage.calculateCost(resolved.cost, finish.tokens),
        tokens: finish.tokens,
      })

      const captureStepEnd = Effect.fnUntraced(function* () {
        const snapshot = yield* snapshots.capture()
        const files =
          startSnapshot && snapshot
            ? startSnapshot === snapshot
              ? []
              : yield* snapshots
                  .files({ from: startSnapshot, to: snapshot })
                  .pipe(Effect.orElseSucceed(() => undefined))
            : undefined
        return { snapshot, files }
      })

      const publishStepEnd = (finish: NonNullable<StepRecord["finish"]>) =>
        Effect.gen(function* () {
          const end = yield* captureStepEnd()
          yield* bus.publish(SessionEvent.Step.Ended, {
            sessionID: session.id,
            assistantMessageID: yield* publisher.startAssistant(),
            finish: finish.finish,
            rawFinish: finish.rawFinish,
            providerState: finish.providerState,
            ...stepUsage(finish),
            ...end,
          })
        })

      // Concurrent writers, no lock: the provider loop and each tool fiber publish
      // durable events unserialized. This is safe because every publisher method commits
      // its state marks synchronously before its first await (see publish-llm-event.ts),
      // every required event order is per-source (each source is one sequential fiber),
      // and a fiber's events are causally after its own Tool.Called: the fork happens
      // below that publish. Cross-source order is unconstrained; either interleaving is
      // a truthful history of concurrent work.
      //
      // The stream is defined here but runs inside the settlement mask below: publish each
      // event durably, fork one fiber per local tool call, and hold back a virgin
      // context-overflow provider error so settlement may recover it via compaction.
      let overflowFailure: ProviderErrorEvent | undefined
      const providerStream = llm.stream(prepared.request, prepared.options).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (
              LLMEvent.is.providerError(event) &&
              isContextOverflowFailure(event) &&
              !publisher.record().outputStarted
            ) {
              overflowFailure = event
              return
            }
            yield* publisher.publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            toolRuns.push({
              call: event,
              fiber: yield* Effect.uninterruptibleMask((restore) =>
                restore(
                  executeTool({
                    sessionID: session.id,
                    agent: agent.id,
                    messageID: assistantMessageID,
                    call: event,
                    // Progress is ephemeral, not durable history: nothing to order.
                    progress: (update) => publisher.progress(event.id, update),
                  }),
                ).pipe(
                  // The fiber owns its call: it publishes its own completion, masked so a
                  // finished execution always reaches its durable settlement.
                  Effect.flatMap(toolOutput.truncate),
                  Effect.flatMap((outcome) => publisher.toolExecution(event.id, event.name, outcome)),
                  Effect.catchTag("Tool.Error", (error) =>
                    publisher.failTool(event.id, toSessionError(error), error.metadata).pipe(Effect.asVoid),
                  ),
                ),
              ).pipe(Effect.forkScoped),
            })
          }),
        ),
        Effect.ensuring(publisher.flush()),
      )

      // Settle: only the stream and the fiber joins are interruptible (restore); every
      // other line is protected so a started call always reaches one durable outcome.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const streamFailure = Option.getOrUndefined(Exit.findErrorOption(stream))
          // Note: Exit.hasInterrupts is a type guard whose false branch unsoundly narrows
          // away non-interrupt failures, so both interrupt checks stay Cause-based.
          const streamInterrupted = stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)

          // Join every owned tool run first: await all exits, not just the first failure.
          // Afterwards no fiber is alive, settlement is the only writer, and the record
          // is final. A failed join means the waiting itself was interrupted, so the runs
          // we abandoned are interrupted before settlement closes them out.
          if (streamInterrupted) yield* interruptTools
          const joined = yield* restore(
            Effect.forEach(toolRuns, (run) => Fiber.await(run.fiber), { concurrency: "unbounded" }),
          ).pipe(Effect.exit)
          if (joined._tag === "Failure") yield* interruptTools
          const tools = classifyToolExits(
            joined,
            toolRuns.map((run) => run.call),
          )

          // A context overflow before any assistant output is recoverable: compact and
          // restart the step instead of surfacing the provider error.
          if (
            recoverOverflow &&
            compaction.enabled() &&
            !publisher.record().outputStarted &&
            isContextOverflowFailure(overflowFailure ?? streamFailure) &&
            (yield* restore(compaction.compact(compactionInput))).status === "completed"
          )
            return CallOutcome.Restart({ step: currentStep, recoveredOverflow: true })

          // An unrecovered held-back overflow becomes the step's durable provider error.
          if (overflowFailure) yield* publisher.publish(overflowFailure)
          // A thrown LLM failure not already recorded as the provider error either
          // escapes as a scheduled retry or fails the assistant durably.
          const unknownFinish =
            stream._tag === "Success" && publisher.record().finish?.finish === "unknown"
              ? new AIError({
                  module: "session",
                  method: "stream",
                  reason: new InvalidProviderOutputReason({
                    classification: "incomplete-stream",
                    message: "The provider response ended with an unknown finish reason.",
                  }),
                })
              : undefined
          const llmFailure = streamFailure instanceof AIError ? streamFailure : unknownFinish
          const llmError = llmFailure && !publisher.record().providerFailed ? toSessionError(llmFailure) : undefined
          if (
            recoverContinuation &&
            llmFailure?.reason._tag === "Transport" &&
            (llmFailure.reason.recovery === "retry-full" || llmFailure.reason.recovery === "rotate-and-retry-full") &&
            !publisher.record().outputStarted
          )
            return CallOutcome.RecoverFull({ step: currentStep })
          if (
            llmFailure &&
            llmError &&
            SessionRunnerRetry.isRetryable(llmFailure) &&
            !publisher.record().outputStarted
          ) {
            // RetryScheduled and Step.Failed fold onto an existing assistant message, so
            // Step.Started must be durable before the failure escapes.
            yield* publisher.startAssistant()
            return yield* new SessionRunnerRetry.RetryableFailure({
              cause: llmFailure,
              error: llmError,
              step: currentStep,
            })
          }
          if (llmError) yield* publisher.failAssistant(llmError)

          // Close every unsettled call with the reason it could not settle truthfully,
          // and fail the assistant when the step itself cannot complete. A declined call
          // settles with its own reason before the generic sweeps.
          for (const decline of tools.declines)
            yield* publisher.failTool(decline.call.id, {
              type: "aborted",
              message:
                decline.reason._tag === "QuestionTool.CancelledError"
                  ? decline.reason.message
                  : "The user declined this tool call",
            })
          if (tools.declines.length > 0 || streamInterrupted || tools.interrupted) {
            yield* publisher.failUnsettledTools(TOOLS_INTERRUPTED)
            yield* publisher.failAssistant(STEP_INTERRUPTED)
          }
          if (tools.failure !== undefined) {
            const error = toSessionError(Cause.squash(tools.failure))
            yield* publisher.failUnsettledTools(error)
          }
          // Local calls have joined, so the remaining sweeps only close hosted calls the
          // provider promised but never resolved.
          if (publisher.record().providerFailed) yield* publisher.failUnsettledTools(TOOLS_INTERRUPTED)
          if (llmError) yield* publisher.failUnsettledTools(RESULT_MISSING, "hosted")
          // A clean stream that still left hosted calls unresolved fails the step itself.
          if (stream._tag === "Success" && !publisher.record().providerFailed) {
            const hostedResultMissing = yield* publisher.failUnsettledTools(RESULT_MISSING, "hosted")
            if (hostedResultMissing && !publisher.record().finish) yield* publisher.failAssistant(RESULT_MISSING)
          }

          // One terminal event: Step.Ended on a clean finish, Step.Failed otherwise.
          const record = publisher.record()
          if (record.finish && !record.failure) yield* publishStepEnd(record.finish)
          if (record.failure) {
            const end = yield* captureStepEnd()
            yield* publisher.publishStepFailure({
              ...(record.finish ? stepUsage(record.finish) : {}),
              ...end,
            })
          }

          if (
            llmFailure &&
            llmError &&
            isInterruptedStream(llmFailure) &&
            record.outputStarted &&
            tools.declines.length === 0 &&
            !tools.interrupted
          )
            return CallOutcome.Continue({
              cause: llmFailure,
              error: llmError,
              step: currentStep,
            })

          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (tools.declines.length > 0) return yield* Effect.interrupt
          if (tools.interrupted && tools.failure) return yield* Effect.failCause(tools.failure)
          if (tools.interrupted && joined._tag === "Failure") return yield* Effect.failCause(joined.cause)
          if (record.failure) return yield* new StepFailedError({ error: record.failure })
          return CallOutcome.Completed({
            // A local call or malformed tool input requires another model step, unless
            // this step already exhausted the agent's allowance.
            needsContinuation:
              !stepLimitReached && record.calls.some((call) => !call.providerExecuted && (call.called || call.settled)),
            step: currentStep,
          })
        }),
      )
    }, Effect.scoped)

    /** Executes a previously admitted manual compaction request, if one is pending. */
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
          const project = pending.payload.location.workspaceID
            ? undefined
            : yield* projects.resolve(pending.payload.location.directory)
          const subpath = project
            ? RelativePath.make(
                path
                  .relative(project.directory, yield* fs.resolve(pending.payload.location.directory))
                  .replaceAll("\\", "/"),
              )
            : pending.payload.subpath
          yield* modelTransport.close(sessionID)
          yield* bus.publishAll([
            [SessionEvent.InboxDelivered, { sessionID, inboxID: pending.id }],
            [
              SessionEvent.Moved,
              {
                sessionID,
                location: pending.payload.location,
                projectID: project?.id ?? pending.payload.projectID,
                subpath,
              },
            ],
          ])
          return { refreshLocation: project !== undefined && project.id !== pending.payload.projectID }
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
    FSUtil.node,
    Project.node,
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
