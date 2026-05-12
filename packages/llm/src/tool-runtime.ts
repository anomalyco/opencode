import { Effect, Stream } from "effect"
import type { Concurrency } from "effect/Types"
import {
  type ContentPart,
  type FinishReason,
  type LLMError,
  LLMEvent,
  LLMRequest,
  Message,
  type ProviderMetadata,
  ToolCallPart,
  ToolFailure,
  ToolResultPart,
  type ToolResultValue,
  Usage,
} from "./schema"
import { type AnyTool, type ExecutableTools, type Tools, toDefinitions } from "./tool"

export interface RuntimeState {
  readonly step: number
  readonly request: LLMRequest
}

export type StopCondition = (state: RuntimeState) => boolean

export type ToolExecution = "auto" | "none"

interface RunOptionsBase {
  readonly request: LLMRequest
  readonly concurrency?: Concurrency
  readonly stopWhen?: StopCondition
}

export type RunOptions<T extends Tools> = RunOptionsAuto<T & ExecutableTools> | RunOptionsNone<T>

export interface RunOptionsAuto<T extends ExecutableTools> extends RunOptionsBase {
  readonly request: LLMRequest
  readonly tools: T
  readonly toolExecution?: "auto"
}

export interface RunOptionsNone<T extends Tools> extends RunOptionsBase {
  readonly request: LLMRequest
  readonly tools: T
  /** Advertise tool schemas but leave model-emitted tool calls for the caller. */
  readonly toolExecution: "none"
}

export type StreamOptions<T extends Tools> = RunOptions<T> & {
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
}

export const stepCountIs =
  (count: number): StopCondition =>
  (state) =>
    state.step + 1 >= count

/**
 * Run a model with typed tools. This helper owns tool orchestration, while the
 * caller supplies the actual model stream function. It can advertise schemas
 * only (`toolExecution: "none"`), execute one step, or continue model rounds
 * when `stopWhen` is provided.
 */
export const stream = <T extends Tools>(options: StreamOptions<T>): Stream.Stream<LLMEvent, LLMError> => {
  const concurrency = options.concurrency ?? 10
  const tools = options.tools as Tools
  const runtimeTools = toDefinitions(tools)
  const runtimeToolNames = new Set(runtimeTools.map((tool) => tool.name))
  const initialRequest =
    runtimeTools.length === 0
      ? options.request
      : LLMRequest.update(options.request, {
          tools: [...options.request.tools.filter((tool) => !runtimeToolNames.has(tool.name)), ...runtimeTools],
        })

  const loop = (
    request: LLMRequest,
    step: number,
    usage: Usage | undefined,
    providerMetadata: ProviderMetadata | undefined,
  ): Stream.Stream<LLMEvent, LLMError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const state: StepState = {
          assistantContent: [],
          toolCalls: [],
          finishReason: undefined,
          usage: undefined,
          providerMetadata: undefined,
        }

        const modelStream = options
          .stream(request)
          .pipe(Stream.map((event) => indexStep(event, step)))
          .pipe(Stream.tap((event) => Effect.sync(() => accumulate(state, event))))
          .pipe(Stream.filter((event) => event.type !== "finish"))

        const continuation = Stream.unwrap(
          Effect.gen(function* () {
            const totalUsage = addUsage(usage, state.usage)
            const totalProviderMetadata = mergeProviderMetadata(providerMetadata, state.providerMetadata)
            const finishStream = Stream.fromIterable([
              LLMEvent.finish({
                reason: state.finishReason ?? "unknown",
                usage: totalUsage,
                providerMetadata: totalProviderMetadata,
              }),
            ])

            if (state.finishReason !== "tool-calls" || state.toolCalls.length === 0) return finishStream
            if (options.toolExecution === "none") return finishStream

            const dispatched = yield* Effect.forEach(
              state.toolCalls,
              (call) => dispatch(tools, call).pipe(Effect.map((result) => [call, result] as const)),
              { concurrency },
            )
            const resultStream = Stream.fromIterable(dispatched.flatMap(([call, result]) => emitEvents(call, result)))

            if (!options.stopWhen) return resultStream.pipe(Stream.concat(finishStream))
            if (options.stopWhen({ step, request })) return resultStream.pipe(Stream.concat(finishStream))

            return resultStream.pipe(
              Stream.concat(
                loop(followUpRequest(request, state, dispatched), step + 1, totalUsage, totalProviderMetadata),
              ),
            )
          }),
        )

        return modelStream.pipe(Stream.concat(continuation))
      }),
    )

  return loop(initialRequest, 0, undefined, undefined)
}

const indexStep = (event: LLMEvent, index: number): LLMEvent => {
  if (event.type === "step-start") return LLMEvent.stepStart({ index })
  if (event.type === "step-finish") return LLMEvent.stepFinish({ ...event, index })
  return event
}

interface StepState {
  assistantContent: ContentPart[]
  toolCalls: ToolCallPart[]
  finishReason: FinishReason | undefined
  usage: Usage | undefined
  providerMetadata: ProviderMetadata | undefined
}

const accumulate = (state: StepState, event: LLMEvent) => {
  if (event.type === "text-delta") {
    appendStreamingText(state, "text", event.text, undefined)
    return
  }
  if (event.type === "reasoning-delta") {
    appendStreamingText(state, "reasoning", event.text, undefined)
    return
  }
  if (event.type === "reasoning-end") {
    appendStreamingText(state, "reasoning", "", event.providerMetadata)
    return
  }
  if (event.type === "text-end") {
    appendStreamingText(state, "text", "", event.providerMetadata)
    return
  }
  if (event.type === "tool-call") {
    const part = ToolCallPart.make({
      id: event.id,
      name: event.name,
      input: event.input,
      providerExecuted: event.providerExecuted,
      providerMetadata: event.providerMetadata,
    })
    state.assistantContent.push(part)
    if (!event.providerExecuted) state.toolCalls.push(part)
    return
  }
  if (event.type === "tool-result" && event.providerExecuted) {
    state.assistantContent.push(
      ToolResultPart.make({
        id: event.id,
        name: event.name,
        result: event.result,
        providerExecuted: true,
        providerMetadata: event.providerMetadata,
      }),
    )
    return
  }
  if (event.type === "step-finish") {
    state.finishReason = event.reason === "stop" && state.toolCalls.length > 0 ? "tool-calls" : event.reason
    state.usage = addUsage(state.usage, event.usage)
    state.providerMetadata = mergeProviderMetadata(state.providerMetadata, event.providerMetadata)
    return
  }
  if (event.type === "finish") {
    state.finishReason ??= event.reason
    state.usage ??= event.usage
    state.providerMetadata = mergeProviderMetadata(state.providerMetadata, event.providerMetadata)
  }
}

const addUsage = (left: Usage | undefined, right: Usage | undefined) => {
  if (!left) return right
  if (!right) return left
  type UsageKey =
    | "inputTokens"
    | "outputTokens"
    | "nonCachedInputTokens"
    | "cacheReadInputTokens"
    | "cacheWriteInputTokens"
    | "reasoningTokens"
    | "totalTokens"
  const sum = (key: UsageKey) =>
    left[key] === undefined && right[key] === undefined ? undefined : Number(left[key] ?? 0) + Number(right[key] ?? 0)

  return new Usage({
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    nonCachedInputTokens: sum("nonCachedInputTokens"),
    cacheReadInputTokens: sum("cacheReadInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    providerMetadata: mergeProviderMetadata(left.providerMetadata, right.providerMetadata),
  })
}

const sameProviderMetadata = (left: ProviderMetadata | undefined, right: ProviderMetadata | undefined) =>
  left === right || JSON.stringify(left) === JSON.stringify(right)

const mergeProviderMetadata = (left: ProviderMetadata | undefined, right: ProviderMetadata | undefined) => {
  if (!left) return right
  if (!right) return left
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).map((provider) => [
      provider,
      { ...left[provider], ...right[provider] },
    ]),
  )
}

const appendStreamingText = (
  state: StepState,
  type: "text" | "reasoning",
  text: string,
  providerMetadata: ProviderMetadata | undefined,
) => {
  const last = state.assistantContent.at(-1)
  if (last?.type === type && text.length === 0) {
    state.assistantContent[state.assistantContent.length - 1] = {
      ...last,
      providerMetadata: mergeProviderMetadata(last.providerMetadata, providerMetadata),
    }
    return
  }
  if (last?.type === type && sameProviderMetadata(last.providerMetadata, providerMetadata)) {
    state.assistantContent[state.assistantContent.length - 1] = { ...last, text: `${last.text}${text}` }
    return
  }
  state.assistantContent.push({ type, text, providerMetadata })
}

const dispatch = (tools: Tools, call: ToolCallPart): Effect.Effect<ToolResultValue> => {
  const tool = tools[call.name]
  if (!tool) return Effect.succeed({ type: "error" as const, value: `Unknown tool: ${call.name}` })
  if (!tool.execute)
    return Effect.succeed({ type: "error" as const, value: `Tool has no execute handler: ${call.name}` })

  return decodeAndExecute(tool, call).pipe(
    Effect.catchTag("LLM.ToolFailure", (failure) =>
      Effect.succeed({ type: "error" as const, value: failure.message } satisfies ToolResultValue),
    ),
  )
}

const decodeAndExecute = (tool: AnyTool, call: ToolCallPart): Effect.Effect<ToolResultValue, ToolFailure> =>
  tool._decode(call.input).pipe(
    Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
    Effect.flatMap((decoded) => tool.execute!(decoded, { id: call.id, name: call.name })),
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
        LLMEvent.toolError({ id: call.id, name: call.name, message: String(result.value) }),
        LLMEvent.toolResult({ id: call.id, name: call.name, result }),
      ]
    : [LLMEvent.toolResult({ id: call.id, name: call.name, result })]

const followUpRequest = (
  request: LLMRequest,
  state: StepState,
  dispatched: ReadonlyArray<readonly [ToolCallPart, ToolResultValue]>,
) =>
  LLMRequest.update(request, {
    messages: [
      ...request.messages,
      Message.assistant(state.assistantContent),
      ...dispatched.map(([call, result]) => Message.tool({ id: call.id, name: call.name, result })),
    ],
  })

export const ToolRuntime = { stream, stepCountIs } as const
