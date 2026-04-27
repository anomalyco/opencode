import {
  LLM,
  type LLMClient,
  type LLMError,
  type LLMEvent,
  type LLMRequest,
  type FinishReason,
  type ContentPart,
  type RequestExecutor,
} from "@opencode-ai/llm"
import { Cause, Deferred, Effect, FiberSet, Queue, Stream, type Scope } from "effect"
import type { Tool, ToolExecutionOptions } from "ai"

// Maximum number of model rounds before the streaming-dispatch loop stops.
// Mirrors `ToolRuntime.run`'s default; tweak via `maxSteps` if a caller needs
// a different ceiling.
export const DEFAULT_MAX_STEPS = 10

// What we care about from the round's events to (a) decide whether to start
// another round and (b) build the continuation request's message history.
interface RoundState {
  finishReason: FinishReason | undefined
  // Echoed back as the next round's assistant message — text deltas merged
  // into a single text part, reasoning deltas into a single reasoning part,
  // tool calls appended in order. Provider-executed tool results are also
  // appended here so the provider sees the full hosted-tool round-trip.
  assistantContent: ContentPart[]
  // Client-side tool dispatches. One entry per `tool-call` event we forked
  // a handler for, populated when the handler completes.
  toolResults: Array<{ id: string; name: string; result: unknown }>
}

const appendStreamingText = (state: RoundState, type: "text" | "reasoning", text: string) => {
  const last = state.assistantContent.at(-1)
  if (last?.type === type) {
    state.assistantContent[state.assistantContent.length - 1] = { ...last, text: `${last.text}${text}` }
    return
  }
  state.assistantContent.push({ type, text })
}

const accumulate = (state: RoundState, event: LLMEvent) => {
  if (event.type === "text-delta") return appendStreamingText(state, "text", event.text)
  if (event.type === "reasoning-delta") return appendStreamingText(state, "reasoning", event.text)
  if (event.type === "tool-call") {
    state.assistantContent.push(
      LLM.toolCall({
        id: event.id,
        name: event.name,
        input: event.input,
        providerExecuted: event.providerExecuted,
      }),
    )
    return
  }
  if (event.type === "tool-result" && event.providerExecuted) {
    state.assistantContent.push(
      LLM.toolResult({
        id: event.id,
        name: event.name,
        result: event.result,
        providerExecuted: true,
      }),
    )
    return
  }
  if (event.type === "request-finish") {
    state.finishReason = event.reason
  }
}

// Dispatch a single client-side tool call. Returns the synthetic LLMEvent
// that should be injected back into the round's stream — either a
// `tool-result` (success) or `tool-error` (handler threw / unknown tool).
// Errors from the AI SDK execute handler are caught and turned into
// `tool-error` so the round survives and the model can self-correct on
// the next step.
const dispatchTool = (
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  tools: Record<string, Tool>,
  abort: AbortSignal,
): Effect.Effect<LLMEvent> =>
  Effect.gen(function* () {
    const tool = tools[call.name]
    if (!tool || typeof tool.execute !== "function") {
      return {
        type: "tool-error",
        id: call.id,
        name: call.name,
        message: `Unknown tool: ${call.name}`,
      } satisfies LLMEvent
    }
    const options: ToolExecutionOptions = {
      toolCallId: call.id,
      messages: [],
      abortSignal: abort,
    }
    return yield* Effect.tryPromise({
      try: () => Promise.resolve(tool.execute!(call.input as never, options)),
      catch: (err) => err,
    }).pipe(
      Effect.map(
        (result): LLMEvent => ({
          type: "tool-result",
          id: call.id,
          name: call.name,
          result: { type: "json", value: result },
        }),
      ),
      Effect.catch(
        (err): Effect.Effect<LLMEvent> =>
          Effect.succeed({
            type: "tool-error",
            id: call.id,
            name: call.name,
            message: err instanceof Error ? err.message : String(err),
          }),
      ),
    )
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
    const state: RoundState = { finishReason: undefined, assistantContent: [], toolResults: [] }
    const done = yield* Deferred.make<RoundState>()

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* client.stream(request).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              accumulate(state, event)
              yield* Queue.offer(queue, event)
              if (event.type === "tool-call" && !event.providerExecuted) {
                yield* FiberSet.run(
                  fiberSet,
                  dispatchTool(event, tools, abort).pipe(
                    Effect.flatMap((resultEvent) =>
                      Effect.gen(function* () {
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

// Build the next round's `LLMRequest` by appending the assistant message that
// echoes everything the round produced (text, reasoning, tool calls, hosted
// tool results) plus a `tool` role message per dispatched result. Lowering
// of these LLM-shaped messages back to the provider wire format is handled
// inside the existing adapter `prepare` step.
const continuationRequest = (request: LLMRequest, state: RoundState): LLMRequest => {
  const assistant = LLM.message({ role: "assistant", content: state.assistantContent })
  const toolMessages = state.toolResults.map((entry) =>
    LLM.toolMessage({ id: entry.id, name: entry.name, result: entry.result }),
  )
  return LLM.updateRequest(request, {
    messages: [...request.messages, assistant, ...toolMessages],
  })
}

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
  readonly abort: AbortSignal
  readonly maxSteps?: number
}): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> => {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS
  const round = (request: LLMRequest, step: number): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const { events, done } = yield* runOneRound(input.client, request, input.tools, input.abort)
        const continuation = Stream.unwrap(
          Effect.gen(function* () {
            const state = yield* Deferred.await(done)
            if (state.finishReason !== "tool-calls") return Stream.empty
            if (state.toolResults.length === 0) return Stream.empty
            if (step + 1 >= maxSteps) return Stream.empty
            return round(continuationRequest(request, state), step + 1)
          }),
        )
        return events.pipe(Stream.concat(continuation))
      }),
    )
  return round(input.request, 0)
}

export * as LLMNativeTools from "./llm-native-tools"
