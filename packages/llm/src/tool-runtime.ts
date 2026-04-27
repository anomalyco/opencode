import { Effect, Stream } from "effect"
import type { Concurrency } from "effect/Types"
import type { LLMClient } from "./adapter"
import type { RequestExecutor } from "./executor"
import * as LLM from "./llm"
import {
  type ContentPart,
  type FinishReason,
  type LLMError,
  type LLMEvent,
  LLMRequest,
  type ToolCallPart,
  type ToolResultValue,
} from "./schema"
import { ToolFailure } from "./schema"
import { type AnyTool, type Tools, toDefinitions } from "./tool"

export interface RuntimeState {
  readonly step: number
  readonly request: LLMRequest
}

export interface RunOptions<T extends Tools> {
  readonly request: LLMRequest
  readonly tools: T
  /**
   * Maximum number of model round-trips before the runtime stops emitting new
   * requests. Defaults to 10. Reaching this limit is not an error — the loop
   * simply stops and the last `request-finish` event is the terminal signal.
   */
  readonly maxSteps?: number
  /**
   * How many tool handlers to dispatch in parallel within a single step.
   * Defaults to 10. Use `"unbounded"` only when handlers do not share an
   * external dependency that can be saturated (rate-limited APIs, single
   * connections, etc).
   */
  readonly concurrency?: Concurrency
  /**
   * Optional predicate evaluated after each step's `request-finish` event. If
   * it returns `true`, the loop stops even if the model wanted to continue.
   */
  readonly stopWhen?: (state: RuntimeState) => boolean
}

/**
 * Run a model with a typed tool record. The runtime streams the model, on
 * each `tool-call` event decodes the input against the tool's `parameters`
 * Schema, dispatches to the matching handler, encodes the handler's result
 * against the tool's `success` Schema, and emits a `tool-result` event. When
 * the model finishes with `tool-calls`, the runtime appends the assistant +
 * tool messages and re-streams. Stops on a non-`tool-calls` finish, when
 * `maxSteps` is reached, or when `stopWhen` returns `true`.
 *
 * Tool handler dependencies are closed over at tool definition time, so the
 * runtime's only environment requirement is the `RequestExecutor.Service`.
 */
export const run = <T extends Tools>(
  client: LLMClient,
  options: RunOptions<T>,
): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> => {
  const maxSteps = options.maxSteps ?? 10
  const concurrency = options.concurrency ?? 10
  const tools = options.tools as Tools
  const runtimeTools = toDefinitions(tools)
  const initialRequest = new LLMRequest({
    ...options.request,
    tools: [
      ...options.request.tools.filter((tool) => !runtimeTools.some((runtimeTool) => runtimeTool.name === tool.name)),
      ...runtimeTools,
    ],
  })

  const loop = (request: LLMRequest, step: number): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const state: StepState = { assistantContent: [], toolCalls: [], finishReason: undefined }

        const modelStream = client.stream(request).pipe(
          Stream.tap((event) => Effect.sync(() => accumulate(state, event))),
        )

        const continuation = Stream.unwrap(
          Effect.gen(function* () {
            if (state.finishReason !== "tool-calls" || state.toolCalls.length === 0) return Stream.empty
            if (options.stopWhen?.({ step, request })) return Stream.empty
            if (step + 1 >= maxSteps) return Stream.empty

            const dispatched = yield* Effect.forEach(
              state.toolCalls,
              (call) => dispatch(tools, call).pipe(Effect.map((result) => [call, result] as const)),
              { concurrency },
            )
            const followUp = new LLMRequest({
              ...request,
              messages: [
                ...request.messages,
                LLM.assistant(state.assistantContent),
                ...dispatched.map(([call, result]) =>
                  LLM.toolMessage({ id: call.id, name: call.name, result }),
                ),
              ],
            })

            return Stream.fromIterable(dispatched.flatMap(([call, result]) => emitEvents(call, result))).pipe(
              Stream.concat(loop(followUp, step + 1)),
            )
          }),
        )

        return modelStream.pipe(Stream.concat(continuation))
      }),
    )

  return loop(initialRequest, 0)
}

interface StepState {
  assistantContent: ContentPart[]
  toolCalls: ToolCallPart[]
  finishReason: FinishReason | undefined
}

const accumulate = (state: StepState, event: LLMEvent) => {
  if (event.type === "text-delta") {
    appendStreamingText(state, "text", event.text)
    return
  }
  if (event.type === "reasoning-delta") {
    appendStreamingText(state, "reasoning", event.text)
    return
  }
  if (event.type === "tool-call") {
    const part = LLM.toolCall({
      id: event.id,
      name: event.name,
      input: event.input,
      providerExecuted: event.providerExecuted,
    })
    state.assistantContent.push(part)
    // Provider-executed tools are dispatched by the provider; the runtime must
    // not invoke a client handler. The matching `tool-result` event arrives
    // later in the same stream and is folded into `assistantContent` so the
    // next round's message history carries it.
    if (!event.providerExecuted) state.toolCalls.push(part)
    return
  }
  if (event.type === "tool-result" && event.providerExecuted) {
    state.assistantContent.push(LLM.toolResult({
      id: event.id,
      name: event.name,
      result: event.result,
      providerExecuted: true,
    }))
    return
  }
  if (event.type === "request-finish") {
    state.finishReason = event.reason
  }
}

const appendStreamingText = (state: StepState, type: "text" | "reasoning", text: string) => {
  const last = state.assistantContent.at(-1)
  if (last?.type === type) {
    state.assistantContent[state.assistantContent.length - 1] = { ...last, text: `${last.text}${text}` }
    return
  }
  state.assistantContent.push({ type, text })
}

const dispatch = (tools: Tools, call: ToolCallPart): Effect.Effect<ToolResultValue> => {
  const tool = tools[call.name]
  if (!tool) return Effect.succeed({ type: "error" as const, value: `Unknown tool: ${call.name}` })

  return decodeAndExecute(tool, call.input).pipe(
    Effect.catchTag("LLM.ToolFailure", (failure) =>
      Effect.succeed({ type: "error" as const, value: failure.message } satisfies ToolResultValue),
    ),
  )
}

const decodeAndExecute = (tool: AnyTool, input: unknown): Effect.Effect<ToolResultValue, ToolFailure> =>
  tool._decode(input).pipe(
    Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
    Effect.flatMap((decoded) => tool.execute(decoded)),
    Effect.flatMap((value) =>
      tool._encode(value).pipe(
        Effect.mapError(
          (error) =>
            new ToolFailure({
              message: `Tool returned an invalid value for its success schema: ${error.message}`,
            }),
        ),
      ),
    ),
    Effect.map((encoded): ToolResultValue => ({ type: "json", value: encoded })),
  )

const emitEvents = (call: ToolCallPart, result: ToolResultValue): ReadonlyArray<LLMEvent> =>
  result.type === "error"
    ? [
        { type: "tool-error", id: call.id, name: call.name, message: String(result.value) },
        { type: "tool-result", id: call.id, name: call.name, result },
      ]
    : [{ type: "tool-result", id: call.id, name: call.name, result }]

export * as ToolRuntime from "./tool-runtime"
