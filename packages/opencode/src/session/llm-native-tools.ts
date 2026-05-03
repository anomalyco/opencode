import {
  Conversation,
  type LLMClient,
  type LLMError,
  type LLMEvent,
  type LLMRequest,
  type RequestExecutor,
} from "@opencode-ai/llm"
import { safeValidateTypes } from "@ai-sdk/provider-utils"
import { Cause, Deferred, Effect, Exit, FiberSet, Queue, Schema, Stream, type Scope } from "effect"
import { asSchema, type Tool, type ToolExecutionOptions } from "ai"
import type { Tool as OpenCodeTool } from "@/tool/tool"

// Maximum number of model rounds before the streaming-dispatch loop stops.
// Mirrors `ToolRuntime.run`'s default; tweak via `maxSteps` if a caller needs
// a different ceiling.
export const DEFAULT_MAX_STEPS = 10

interface RoundState extends Conversation.State {
  // Client-side tool dispatches. One entry per `tool-call` event we forked
  // a handler for, populated when the handler completes.
  toolResults: Conversation.ToolResultInput[]
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const validationError = (error: unknown) => `Invalid tool input: ${errorMessage(error)}`

const inputValidationError = (error: unknown) => ({ _tag: "InputValidationError" as const, message: validationError(error) })

const isInputValidationError = (error: unknown): error is ReturnType<typeof inputValidationError> =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "InputValidationError"

const inputValidationMessage = (error: unknown) => {
  if (isInputValidationError(error)) return error.message
  const message = errorMessage(error)
  return message.includes("Invalid tool input") ? message : undefined
}

const causeError = (cause: Cause.Cause<unknown>) =>
  (cause as { readonly failures?: ReadonlyArray<{ readonly _tag: string; readonly error?: unknown }> }).failures
    ?.find((failure) => failure._tag === "Fail")?.error ?? Cause.pretty(cause)

const repairCall = (
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  tools: Record<string, Tool>,
  error: string,
) => {
  const lower = call.name.toLowerCase()
  if (lower !== call.name && tools[lower]) return { ...call, name: lower }
  if (call.name !== "invalid" && tools.invalid) {
    return { ...call, name: "invalid", input: { tool: call.name, error } }
  }
  return undefined
}

const validateInput = (tool: Tool, input: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const result = await safeValidateTypes({ value: input, schema: asSchema(tool.inputSchema) })
      if (result.success) return result.value
      throw result.error
    },
    catch: inputValidationError,
  })

const validateNativeInput = (tool: OpenCodeTool.Def | undefined, input: unknown) => {
  if (!tool) return Effect.succeed(input)
  return Schema.decodeUnknownEffect(tool.parameters)(input).pipe(Effect.mapError(inputValidationError))
}

const executeTool = (
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  tool: Tool,
  nativeTool: OpenCodeTool.Def | undefined,
  abort: AbortSignal,
) => {
  const options: ToolExecutionOptions = {
    toolCallId: call.id,
    messages: [],
    abortSignal: abort,
  }
  return validateNativeInput(nativeTool, call.input).pipe(
    Effect.flatMap((input) => validateInput(tool, input)),
    Effect.flatMap((input) =>
      Effect.tryPromise({
        try: () => Promise.resolve(tool.execute!(input as never, options)),
        catch: (err) => err,
      }),
    ),
  )
}

const dispatchFailureEvent = (
  call: { readonly id: string; readonly name: string },
  cause: Cause.Cause<unknown>,
): LLMEvent => ({
  type: "tool-error",
  id: call.id,
  name: call.name,
  message: errorMessage(causeError(cause)),
})

// Dispatch a single client-side tool call. Returns the synthetic LLMEvent
// that should be injected back into the round's stream — either a
// `tool-result` (success) or `tool-error` (handler threw / unknown tool).
// Errors from the AI SDK execute handler are caught and turned into
// `tool-error` so the round survives and the model can self-correct on
// the next step.
const dispatchTool = (
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  tools: Record<string, Tool>,
  nativeTools: ReadonlyMap<string, OpenCodeTool.Def>,
  abort: AbortSignal,
): Effect.Effect<LLMEvent> =>
  Effect.gen(function* () {
    const tool = tools[call.name]
    if (!tool || typeof tool.execute !== "function") {
      const repaired = repairCall(call, tools, `Unknown tool: ${call.name}`)
      if (repaired) return yield* dispatchTool(repaired, tools, nativeTools, abort)
      return {
        type: "tool-error",
        id: call.id,
        name: call.name,
        message: `Unknown tool: ${call.name}`,
      } satisfies LLMEvent
    }
    const exit = yield* Effect.exit(executeTool(call, tool, nativeTools.get(call.name), abort))
    if (Exit.isSuccess(exit)) {
      return {
        type: "tool-result",
        id: call.id,
        name: call.name,
        result: { type: "json", value: exit.value },
      } satisfies LLMEvent
    }
    const err = causeError(exit.cause)
    const invalidInput = inputValidationMessage(err)
    if (invalidInput) {
      const repaired = repairCall(call, tools, invalidInput)
      if (repaired) return yield* dispatchTool(repaired, tools, nativeTools, abort)
    }
    return {
      type: "tool-error",
      id: call.id,
      name: call.name,
      message: invalidInput ?? errorMessage(err),
    } satisfies LLMEvent
  })

// Drive one model round. Streams every LLM event in real time; each
// non-provider-executed `tool-call` event forks a dispatcher fiber that
// pushes the resulting `tool-result` (or `tool-error`) event back into the
// same stream as soon as the handler completes. The round ends when:
//   1. the LLM stream completes, AND
//   2. every forked dispatcher has finished.
// At that point the queue is closed (consumers see end-of-stream) and
// `done` resolves with the accumulated state so the multi-round driver can
// decide whether to recurse.
const runOneRound = (
  client: LLMClient,
  request: LLMRequest,
  tools: Record<string, Tool>,
  nativeTools: ReadonlyMap<string, OpenCodeTool.Def>,
  abort: AbortSignal,
): Effect.Effect<
  {
    readonly events: Stream.Stream<LLMEvent, LLMError>
    readonly done: Deferred.Deferred<RoundState>
  },
  never,
  Scope.Scope | RequestExecutor.Service
> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<LLMEvent, LLMError | Cause.Done>()
    const fiberSet = yield* FiberSet.make<unknown, never>()
    const state: RoundState = { ...Conversation.empty(), toolResults: [] }
    const done = yield* Deferred.make<RoundState>()

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* client.stream(request).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              const deltas = Conversation.mutate(state, event)
              yield* Queue.offer(queue, event)
              const call = Conversation.clientToolCallAdded(deltas)
              if (call) {
                yield* FiberSet.run(
                  fiberSet,
                  Effect.exit(dispatchTool(call, tools, nativeTools, abort)).pipe(
                    Effect.flatMap((exit) =>
                      Effect.gen(function* () {
                        const resultEvent = Exit.isSuccess(exit) ? exit.value : dispatchFailureEvent(call, exit.cause)
                        if (resultEvent.type === "tool-result") {
                          state.toolResults.push({
                            id: resultEvent.id,
                            name: resultEvent.name,
                            result: (resultEvent.result as { readonly value: unknown }).value,
                          })
                        }
                        yield* Queue.offer(queue, resultEvent)
                      }),
                    ),
                  ),
                )
              }
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Queue.failCause(queue, cause)
              yield* Deferred.succeed(done, state)
            }),
          ),
        )
        yield* FiberSet.awaitEmpty(fiberSet)
        yield* Queue.end(queue)
        yield* Deferred.succeed(done, state)
      }),
    )

    return { events: Stream.fromQueue(queue), done }
  })

/**
 * Run a multi-round model+tool stream with streaming dispatch within each
 * round. As each `tool-call` event arrives, the matching AI SDK tool's
 * `execute` runs in a forked fiber and its result is injected back into the
 * stream as a synthetic `tool-result` event. This matches the AI SDK's
 * `streamText` UX: long-running tools don't block subsequent tool-call
 * streaming, and consumers see results land as they complete.
 *
 * Stops when the model finishes a round with anything other than
 * `tool-calls`, when `maxSteps` is reached, or when the underlying scope is
 * interrupted (e.g. via the abort signal).
 */
export const runWithTools = (input: {
  readonly client: LLMClient
  readonly request: LLMRequest
  readonly tools: Record<string, Tool>
  readonly nativeTools?: ReadonlyArray<OpenCodeTool.Def>
  readonly abort: AbortSignal
  readonly maxSteps?: number
}): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> => {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS
  const nativeTools = new Map((input.nativeTools ?? []).map((tool) => [tool.id, tool] as const))
  const round = (request: LLMRequest, step: number): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const { events, done } = yield* runOneRound(input.client, request, input.tools, nativeTools, input.abort)
        const continuation = Stream.unwrap(
          Effect.gen(function* () {
            const state = yield* Deferred.await(done)
            if (state.finishReason !== "tool-calls") return Stream.empty
            if (state.toolResults.length === 0) return Stream.empty
            if (step + 1 >= maxSteps) return Stream.empty
            return round(
              Conversation.continueRequest({
                request,
                state,
                results: state.toolResults,
              }),
              step + 1,
            )
          }),
        )
        return events.pipe(Stream.concat(continuation))
      }),
    )
  return round(input.request, 0)
}

export * as LLMNativeTools from "./llm-native-tools"
