import { Effect, Stream } from "effect"
import type { Concurrency } from "effect/Types"
import type { LLMClient } from "./adapter"
import { Conversation } from "./conversation"
import type { RequestExecutor } from "./executor"
import * as LLM from "./llm"
import {
  type LLMError,
  type LLMEvent,
  type LLMRequest,
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
  const initialRequest = LLM.updateRequest(options.request, {
    tools: [
      ...options.request.tools.filter((tool) => !runtimeTools.some((runtimeTool) => runtimeTool.name === tool.name)),
      ...runtimeTools,
    ],
  })

  const loop = (request: LLMRequest, step: number): Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const state = Conversation.empty()

        const modelStream = client.stream(request).pipe(
          Stream.tap((event) => Effect.sync(() => Conversation.mutate(state, event))),
        )

        const continuation = Stream.unwrap(
          Effect.gen(function* () {
            if (!Conversation.needsClientToolResults(state)) return Stream.empty
            if (options.stopWhen?.({ step, request })) return Stream.empty
            if (step + 1 >= maxSteps) return Stream.empty

            const dispatched = yield* Effect.forEach(
              state.clientToolCalls,
              (call) => dispatch(tools, call).pipe(Effect.map((result) => [call, result] as const)),
              { concurrency },
            )
            const followUp = Conversation.continueRequest({
              request,
              state,
              results: dispatched.map(([call, result]) => ({ id: call.id, name: call.name, result })),
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

const dispatch = Effect.fn("ToolRuntime.dispatch")(function* (tools: Tools, call: ToolCallPart) {
  const tool = tools[call.name]
  if (!tool) return { type: "error" as const, value: `Unknown tool: ${call.name}` }

  return yield* decodeAndExecute(tool, call.input).pipe(
    Effect.catchTag("LLM.ToolFailure", (failure) =>
      Effect.succeed({ type: "error" as const, value: failure.message } satisfies ToolResultValue),
    ),
  )
})

const decodeAndExecute = Effect.fn("ToolRuntime.decodeAndExecute")(function* (
  tool: AnyTool,
  input: unknown,
) {
  return yield* tool._decode(input).pipe(
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
})

const emitEvents = (call: ToolCallPart, result: ToolResultValue): ReadonlyArray<LLMEvent> =>
  result.type === "error"
    ? [
        { type: "tool-error", id: call.id, name: call.name, message: String(result.value) },
        { type: "tool-result", id: call.id, name: call.name, result },
      ]
    : [{ type: "tool-result", id: call.id, name: call.name, result }]

export * as ToolRuntime from "./tool-runtime"
