import { Effect, Schema, Stream } from "effect"
import type { LLMClient } from "./adapter"
import type { RequestExecutor } from "./executor"
import * as LLM from "./llm"
import type {
  ContentPart,
  FinishReason,
  LLMError,
  LLMEvent,
  LLMRequest,
  ToolCallPart,
  ToolResultValue,
  Usage,
} from "./schema"
import { ToolFailure } from "./schema"
import { type Tool, type Tools, toDefinitions } from "./tool"

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
   * Optional predicate evaluated after each step's `request-finish` event. If
   * it returns `true`, the loop stops even if the model wanted to continue.
   */
  readonly stopWhen?: (state: RuntimeState) => boolean
}

const DEFAULT_MAX_STEPS = 10

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
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
  const tools = options.tools as Tools
  const definitions = toDefinitions(tools)
  const initialRequest: LLMRequest = {
    ...options.request,
    tools: [...options.request.tools, ...definitions],
  } as LLMRequest

  const loop = (request: LLMRequest, step: number): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const state: StepState = {
          assistantContent: [],
          toolCalls: [],
          finishReason: undefined,
          usage: undefined,
        }

        const modelStream = client.stream(request).pipe(
          Stream.tap((event) => Effect.sync(() => accumulate(state, event))),
        )

        const continuation = Stream.unwrap(
          Effect.gen(function* () {
            if (state.finishReason !== "tool-calls" || state.toolCalls.length === 0) return Stream.empty
            if (options.stopWhen?.({ step, request })) return Stream.empty
            if (step + 1 >= maxSteps) return Stream.empty

            const dispatched = yield* Effect.forEach(state.toolCalls, (call) => dispatch(tools, call), {
              concurrency: "unbounded",
            })
            const followUp: LLMRequest = {
              ...request,
              messages: [
                ...request.messages,
                LLM.assistant(state.assistantContent),
                ...dispatched.map(({ call, result }) =>
                  LLM.toolMessage({ id: call.id, name: call.name, result }),
                ),
              ],
            } as LLMRequest

            const dispatchEvents = Stream.fromIterable(
              dispatched.flatMap(({ call, result }) => emitEvents(call, result)),
            )
            return dispatchEvents.pipe(Stream.concat(loop(followUp, step + 1)))
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
  usage: Usage | undefined
}

const accumulate = (state: StepState, event: LLMEvent) => {
  if (event.type === "text-delta") {
    const last = state.assistantContent.at(-1)
    if (last?.type === "text") {
      state.assistantContent[state.assistantContent.length - 1] = { ...last, text: `${last.text}${event.text}` }
    } else {
      state.assistantContent.push({ type: "text", text: event.text })
    }
    return
  }
  if (event.type === "reasoning-delta") {
    const last = state.assistantContent.at(-1)
    if (last?.type === "reasoning") {
      state.assistantContent[state.assistantContent.length - 1] = { ...last, text: `${last.text}${event.text}` }
    } else {
      state.assistantContent.push({ type: "reasoning", text: event.text })
    }
    return
  }
  if (event.type === "tool-call") {
    const part: ToolCallPart = { type: "tool-call", id: event.id, name: event.name, input: event.input }
    state.assistantContent.push(part)
    state.toolCalls.push(part)
    return
  }
  if (event.type === "request-finish") {
    state.finishReason = event.reason
    if (event.usage !== undefined) state.usage = event.usage
    return
  }
  if (event.type === "step-finish" && event.usage !== undefined) {
    state.usage = event.usage
  }
}

interface Dispatched {
  readonly call: ToolCallPart
  readonly result: ToolResultValue
}

const dispatch = (tools: Tools, call: ToolCallPart): Effect.Effect<Dispatched> => {
  const tool = tools[call.name]
  if (!tool) {
    return Effect.succeed({
      call,
      result: { type: "error" as const, value: `Unknown tool: ${call.name}` },
    })
  }

  return decodeAndExecute(tool, call.input).pipe(
    Effect.map((result): Dispatched => ({ call, result })),
    Effect.catchTag(
      "LLM.ToolFailure",
      (failure): Effect.Effect<Dispatched> =>
        Effect.succeed({ call, result: { type: "error" as const, value: failure.message } }),
    ),
  )
}

const decodeAndExecute = (
  tool: Tool<Schema.Top, Schema.Top>,
  input: unknown,
): Effect.Effect<ToolResultValue, ToolFailure> => {
  const decode = Schema.decodeUnknownEffect(tool.parameters) as unknown as (
    input: unknown,
  ) => Effect.Effect<unknown, { readonly message?: string }>
  const encode = Schema.encodeEffect(tool.success) as unknown as (
    value: unknown,
  ) => Effect.Effect<unknown, { readonly message?: string }>

  return decode(input).pipe(
    Effect.mapError(
      (error) => new ToolFailure({ message: `Invalid tool input: ${error.message ?? String(error)}` }),
    ),
    Effect.flatMap((decoded) => tool.execute(decoded as never)),
    Effect.flatMap((value) =>
      encode(value).pipe(
        Effect.mapError(
          (error) =>
            new ToolFailure({
              message: `Tool returned an invalid value for its success schema: ${error.message ?? String(error)}`,
            }),
        ),
      ),
    ),
    Effect.map((encoded): ToolResultValue => ({ type: "json", value: encoded })),
  )
}

const emitEvents = (call: ToolCallPart, result: ToolResultValue): ReadonlyArray<LLMEvent> =>
  result.type === "error"
    ? [{ type: "tool-error", id: call.id, name: call.name, message: String(result.value) }]
    : [{ type: "tool-result", id: call.id, name: call.name, result }]

export * as ToolRuntime from "./tool-runtime"
