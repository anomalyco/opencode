export * as SessionStep from "./step.js"

import {
  AIError,
  InvalidProviderOutputError,
  LLMClient,
  isContextOverflowFailure,
  type ToolCall,
} from "@opencode/ai/effect"
import type { Agent } from "@opencode/schema/agent"
import { Cause, Clock, Data, Deferred, Effect, Exit, Fiber, Option, Stream } from "effect"
import { SessionError } from "@opencode/schema/session-error"
import { Bus } from "../../bus.js"
import { Permission } from "../../permission.js"
import { Snapshot } from "../../snapshot.js"
import { Tool } from "../../tool.js"
import { ToolOutput } from "../../tool-output.js"
import { QuestionTool } from "../../tool/plugin/question.js"
import { StepFailedError } from "../error.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionModelRequest } from "../model-request.js"
import { SessionSchema } from "../schema.js"
import { toSessionError } from "../to-session-error.js"
import { SessionUsage } from "../usage.js"
import { SessionRunnerModel } from "./model.js"
import { createLLMEventPublisher } from "./publish-llm-event.js"
import { SessionRunnerRetry } from "./retry.js"

export type Outcome = Data.TaggedEnum<{
  Completed: { readonly needsContinuation: boolean }
  Retry: {
    readonly error: SessionError.Error
    readonly decision: SessionRunnerRetry.Decision
    readonly freshAssistant?: boolean
  }
  RecoverFull: {}
  Compacted: {}
  OutputLimit: { readonly needsContinuation: boolean }
}>
export const Outcome = Data.taggedEnum<Outcome>()

interface Input {
  readonly isLocationClosed: () => boolean
  /** Why the execution is being interrupted, once it is: `"user"` when someone stopped it. */
  readonly interruption?: () => "user" | "shutdown" | undefined
  readonly sessionID: SessionSchema.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly agent: Agent.ID
  readonly model: SessionRunnerModel.Resolved
  readonly prepared: Omit<SessionModelRequest.Prepared, "event">
  /** Set when this attempt runs because an earlier one in the step scheduled a retry. */
  readonly retryAttempt?: number
  readonly retry: (
    cause: AIError,
    error: SessionError.Error,
    retry: boolean,
  ) => Effect.Effect<{ readonly retry: false } | SessionRunnerRetry.Decision>
  readonly recoverContinuation: boolean
  /** The runner owns compaction policy; the attempt invokes it only before durable output. */
  readonly recoverOverflow: Effect.Effect<boolean>
}

const TOOLS_INTERRUPTED = { type: "aborted", message: "Tool execution interrupted" } as const
const STEP_INTERRUPTED = { type: "aborted", message: "Step interrupted" } as const
const RESULT_MISSING = { type: "tool.result-missing", message: "Provider did not return a tool result" } as const

/** Captures Location-scoped dependencies without introducing another service or execution loop. */
export const make = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const llm = yield* LLMClient.Service
  const snapshots = yield* Snapshot.Service
  const toolOutput = yield* ToolOutput.Service

  const attempt = Effect.fn("SessionStep.attempt")(function* (input: Input) {
    // The start snapshot only has to exist before local tools run, which cannot happen before Step.Started,
    // so it is captured while the provider request is in flight instead of delaying it.
    const pendingStartSnapshot = yield* snapshots.capture().pipe(Effect.forkScoped)
    const started = yield* Clock.currentTimeMillis
    let firstOutputAt: number | undefined
    const modelAttributes = {
      "gen_ai.provider.name": input.model.ref.providerID,
      "gen_ai.request.model": input.model.ref.id,
    }
    yield* Effect.annotateCurrentSpan({
      ...modelAttributes,
      "gen_ai.agent.name": input.agent,
      ...(input.retryAttempt === undefined ? {} : { "opencode.retry.attempt": input.retryAttempt }),
    })
    const publisher = createLLMEventPublisher(bus, {
      sessionID: input.sessionID,
      assistantMessageID: input.assistantMessageID,
      agent: input.agent,
      model: input.model.ref,
      providerMetadataKey: input.model.model.route.providerMetadataKey ?? input.model.model.provider,
      pendingSnapshot: Fiber.join(pendingStartSnapshot),
      started,
    })
    const toolRuns: Array<{
      readonly call: ToolCall
      readonly fiber: Fiber.Fiber<void, Permission.DeclinedError | QuestionTool.CancelledError>
      readonly cancel: Cancel
    }> = []
    const interruptTools = Effect.suspend(() => Fiber.interruptAll(toolRuns.map((run) => run.fiber)))
    // A user's stop asks each tool awaiting `cancel` to stop and settle its own call, and interrupts every other
    // tool. A tool that does not settle in time is interrupted too. Teardown interrupts every tool.
    const stopTools = Effect.suspend(() => {
      const user = input.interruption?.() === "user" && !input.isLocationClosed()
      const immediate = toolRuns.flatMap((run) => (user && run.cancel.trigger() ? [] : [run.fiber]))
      return Fiber.interruptAll(immediate).pipe(
        Effect.andThen(Fiber.awaitAll(toolRuns.map((run) => run.fiber)).pipe(Effect.timeoutOption(COOPERATIVE_STOP))),
        Effect.flatMap((settled) => (Option.isSome(settled) ? Effect.void : interruptTools)),
      )
    })
    const executeTool = (call: ToolCall, cancel: Cancel) => {
      if (input.prepared.request.toolChoice?.type === "none")
        return new Tool.Error({ message: "Tools are disabled after the maximum agent steps" })
      return input.prepared.executeTool({
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.assistantMessageID,
        call,
        progress: (update) => publisher.progress(call.id, update),
        cancel: cancel.effect,
      })
    }

    // Provider and tool fibers retain per-source order without a shared writer queue.
    // A local execution starts only after its Tool.Called publication completes.
    // Read to the end, not just the finish event, so the next request can reuse this response.
    // The span covers only the provider stream, so model time separates from tools, which run in this consumer.
    const providerStream = llm.stream(input.prepared.request, input.prepared.options).pipe(
      Stream.withSpan("LLM.stream", { attributes: modelAttributes }),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (publisher.record().providerFailed) return
          // Wait here, where cancellation still works, rather than inside the uninterruptible publish.
          if (!publisher.hasStarted()) yield* Fiber.join(pendingStartSnapshot)
          yield* publisher.publish(event)
          if (firstOutputAt === undefined && publisher.record().outputStarted)
            firstOutputAt = yield* Clock.currentTimeMillis
          if (event.type !== "tool-call" || event.providerExecuted) return
          const cancel = makeCancel()
          toolRuns.push({
            call: event,
            cancel,
            fiber: yield* Effect.uninterruptibleMask((restore) =>
              restore(executeTool(event, cancel)).pipe(
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

    // Keep the final tool and Step events uninterruptible, even when the work itself is cancelled.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const stream = yield* restore(providerStream).pipe(Effect.exit)
        const streamFailure = Option.getOrUndefined(Exit.findErrorOption(stream))
        const streamInterrupted = Exit.hasInterrupts(stream)
        // Cancelled before the start snapshot existed: record nothing, as when the capture preceded the request.
        if (
          Exit.isFailure(stream) &&
          streamInterrupted &&
          !publisher.hasStarted() &&
          !pendingStartSnapshot.pollUnsafe()
        )
          return yield* Effect.failCause(stream.cause)
        if (publisher.hasStarted()) yield* publisher.streamed()
        if (streamInterrupted) yield* stopTools
        const joined = yield* restore(Fiber.awaitAll(toolRuns.map((run) => run.fiber))).pipe(Effect.exit)
        if (!streamInterrupted && Exit.isFailure(joined)) yield* stopTools
        const tools = classifyToolExits(joined, toolRuns)

        if (
          !publisher.record().outputStarted &&
          isContextOverflowFailure(streamFailure) &&
          (yield* restore(input.recoverOverflow))
        ) {
          yield* Effect.logWarning("provider rejected the request as too long; compacting", {
            sessionID: input.sessionID,
            model: input.model.ref,
            message: streamFailure?.message,
          })
          return Outcome.Compacted()
        }

        const recorded = publisher.record()
        const unknownFinish =
          Exit.isSuccess(stream) && recorded.finish?.finish === "unknown"
            ? new AIError({
                reason: new InvalidProviderOutputError({
                  message: "The provider response ended with an unknown finish reason.",
                  classification: "incomplete-stream",
                }),
              })
            : undefined
        const llmFailure = streamFailure instanceof AIError ? streamFailure : unknownFinish
        const llmError = llmFailure && !recorded.providerFailed ? toSessionError(llmFailure) : undefined
        const tokens = recorded.finish?.usage
        yield* Effect.annotateCurrentSpan({
          ...(firstOutputAt === undefined ? {} : { "opencode.llm.first_output_ms": firstOutputAt - started }),
          ...(recorded.finish === undefined ? {} : { "gen_ai.response.finish_reasons": [recorded.finish.finish] }),
          ...(tokens?.inputTokens === undefined ? {} : { "gen_ai.usage.input_tokens": tokens.inputTokens }),
          ...(tokens?.outputTokens === undefined ? {} : { "gen_ai.usage.output_tokens": tokens.outputTokens }),
          ...(tokens?.cacheReadInputTokens === undefined
            ? {}
            : { "gen_ai.usage.cache_read.input_tokens": tokens.cacheReadInputTokens }),
          ...(tokens?.cacheWriteInputTokens === undefined
            ? {}
            : { "gen_ai.usage.cache_creation.input_tokens": tokens.cacheWriteInputTokens }),
          ...(llmFailure === undefined ? {} : { "error.type": llmFailure.reason._tag }),
        })
        if (
          input.recoverContinuation &&
          llmFailure?.reason._tag === "Transport" &&
          (llmFailure.reason.recovery === "retry-full" || llmFailure.reason.recovery === "rotate-and-retry-full") &&
          !recorded.outputStarted
        )
          return Outcome.RecoverFull()
        const retry =
          llmFailure && llmError && !isContextOverflowFailure(llmFailure)
            ? yield* restore(
                input.retry(
                  llmFailure,
                  llmError,
                  SessionRunnerRetry.isRetryable(llmFailure) ||
                    (recorded.outputStarted && isInterruptedStream(llmFailure)),
                ),
              )
            : undefined
        if (llmError && retry?.retry && !recorded.outputStarted) {
          // Retry state projects onto the existing assistant, even before it has produced output.
          yield* publisher.startAssistant()
          return Outcome.Retry({ error: llmError, decision: retry })
        }
        if (llmError) yield* publisher.failAssistant(llmError)

        for (const decline of tools.declines)
          yield* publisher.failTool(decline.call.id, {
            type: "aborted",
            message: input.isLocationClosed()
              ? "Interaction cancelled because the location shut down"
              : decline.reason._tag === "QuestionTool.CancelledError"
                ? decline.reason.message
                : "The user declined this tool call",
          })
        const interrupted = tools.declines.length > 0 || streamInterrupted || tools.interrupted
        const toolFailure = interrupted
          ? TOOLS_INTERRUPTED
          : tools.failure !== undefined
            ? toSessionError(Cause.squash(tools.failure))
            : recorded.providerFailed
              ? TOOLS_INTERRUPTED
              : undefined
        if (toolFailure) yield* publisher.failUnsettledTools(toolFailure)
        if (interrupted) yield* publisher.failAssistant(STEP_INTERRUPTED)

        // Parsers may leave unfinished calls without an execution event.
        if (llmError || (Exit.isSuccess(stream) && !recorded.providerFailed)) {
          const missing = yield* publisher.failUnsettledTools(RESULT_MISSING, "hosted")
          if (missing && !llmError && !recorded.finish) yield* publisher.failAssistant(RESULT_MISSING)
          yield* publisher.failIncompleteTools()
        }

        const record = publisher.record()
        if (record.finish || record.failure) {
          const startSnapshot = yield* Fiber.join(pendingStartSnapshot)
          const snapshot = yield* snapshots.capture()
          const files =
            startSnapshot && snapshot
              ? startSnapshot === snapshot
                ? []
                : yield* snapshots
                    .files({ from: startSnapshot, to: snapshot })
                    .pipe(Effect.orElseSucceed(() => undefined))
              : undefined
          const usage = record.finish ? SessionUsage.record(record.finish.usage, input.model.cost) : undefined
          if (usage) yield* Effect.annotateCurrentSpan("opencode.usage.cost_usd", usage.cost)
          if (record.failure) yield* publisher.publishStepFailure({ ...usage, snapshot, files })
          if (record.finish && usage && !record.failure)
            yield* bus.publish(SessionEvent.Step.Ended, {
              sessionID: input.sessionID,
              assistantMessageID: yield* publisher.startAssistant(),
              finish: record.finish.finish,
              rawFinish: record.finish.rawFinish,
              native: record.finish.native,
              ...usage,
              snapshot,
              files,
            })
        }

        if (llmError && retry?.retry && tools.declines.length === 0 && !tools.interrupted)
          return Outcome.Retry({ error: llmError, decision: retry, freshAssistant: true })

        if (Exit.isFailure(stream)) return yield* Effect.failCause(stream.cause)
        if (tools.declines.length > 0) {
          if (input.isLocationClosed()) return Outcome.Completed({ needsContinuation: true })
          return yield* Effect.interrupt
        }
        if (tools.interrupted && tools.failure) return yield* Effect.failCause(tools.failure)
        if (tools.interrupted && Exit.isFailure(joined)) return yield* Effect.failCause(joined.cause)
        if (record.failure) return yield* new StepFailedError({ error: record.failure })
        const needsContinuation = input.prepared.request.toolChoice?.type !== "none" && record.needsContinuation
        if (record.finish?.finish === "length") return Outcome.OutputLimit({ needsContinuation })
        return Outcome.Completed({ needsContinuation })
      }),
    )
  }, Effect.scoped)

  return { attempt }
})

const isInterruptedStream = (failure: AIError) => {
  if (failure.reason._tag === "InvalidProviderOutput") return failure.reason.classification === "incomplete-stream"
  if (failure.reason._tag === "Transport") return failure.reason.operation === "read"
  return false
}

/** Tool.Error settles in each fiber; only user declines remain in the typed error channel. */
const classifyToolExits = (
  settled: Exit.Exit<Array<Exit.Exit<void, Permission.DeclinedError | QuestionTool.CancelledError>>>,
  runs: ReadonlyArray<{ readonly call: ToolCall }>,
) => {
  const exits = Exit.isSuccess(settled) ? settled.value : []
  const declines = exits.flatMap((exit, index) =>
    Exit.isFailure(exit)
      ? exit.cause.reasons.flatMap((reason) =>
          Cause.isFailReason(reason) ? [{ call: runs[index].call, reason: reason.error }] : [],
        )
      : [],
  )
  const causes = Exit.isFailure(settled)
    ? [settled.cause]
    : exits.flatMap((exit) => (Exit.isFailure(exit) ? [exit.cause] : []))
  const failure = causes
    .flatMap((cause) => {
      if (Cause.hasInterrupts(cause)) return []
      const reasons = cause.reasons.filter(Cause.isDieReason)
      return reasons.length > 0 ? [Cause.fromReasons<never>(reasons)] : []
    })
    .at(0)
  return { interrupted: causes.some(Cause.hasInterrupts), declines, failure }
}

// How long a user's stop waits for the tools it asked to stop before interrupting them.
const COOPERATIVE_STOP = "5 seconds"

type Cancel = ReturnType<typeof makeCancel>

// A tool call's `cancel`. `trigger` completes it, and reports whether the tool was awaiting it, so would stop on its
// own; a tool that was not is interrupted instead.
const makeCancel = () => {
  let listeners = 0
  let cancelled = false
  const gate = Deferred.makeUnsafe<void>()
  return {
    effect: Effect.suspend(() => {
      if (cancelled) return Effect.void
      listeners++
      return Deferred.await(gate).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            listeners--
          }),
        ),
      )
    }),
    trigger: () => {
      cancelled = true
      if (listeners === 0) return false
      Deferred.doneUnsafe(gate, Exit.void)
      return true
    },
  }
}
