import { Effect, JsonSchema, Schema, Stream } from "effect"
import { tryRequest } from "./media-model.js"
import {
  LLMClient,
  Service,
  canCompact,
  compactRequest,
  type CheckpointRequest,
  type CompactionRequest,
  type EndpointCompactOptions,
  type StreamOptions,
  type TriggerCompactOptions,
} from "./route/client.js"
import {
  GenerationOptions,
  HttpOptions,
  InvalidProviderOutputError,
  InvalidRequestError,
  AIError,
  LLMEvent,
  LLMResponse,
  Message,
  LanguageModel,
  SystemPart,
  type CachePolicy,
  type CompactionCheckpointResponse,
  type CompactionResponse,
  type Finish,
  ToolChoice,
  ToolEntry,
  type ContentPart,
  type LanguageModelProviderOptions,
  type LLMRequest,
  type ToolEntryInput,
  withPartial,
} from "./schema/index.js"
import { tool, type ExecutableTool, type Tool, type ToolSchema } from "./tool.js"
import { ToolRuntime } from "./tool-runtime.js"

/** Input accepted by `ai.request`, `ai.generate`, `ai.stream` and `ai.compact`. An `LLMRequest` is also a valid input. */
export type LLMRequestInput<Model extends LanguageModel = LanguageModel> = TextRequestFields<Model> & PromptOrMessages

/** Exactly one of `prompt`, a single user message, or `messages`, the full conversation. */
export type PromptOrMessages =
  | { readonly prompt: string | ContentPart | ReadonlyArray<ContentPart>; readonly messages?: never }
  | { readonly messages: ReadonlyArray<Message | Message.Input>; readonly prompt?: never }

interface TextRequestFields<Model extends LanguageModel> {
  readonly id?: string
  readonly model: Model
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  /** Sent in array order. Pass `tool(...)` values or wire entries such as hosted provider tools. */
  readonly tools?: ReadonlyArray<Tool | ToolEntryInput>
  readonly toolChoice?: ToolChoice.Input
  readonly generation?: GenerationOptions.Input
  readonly providerOptions?: NoInfer<LanguageModelProviderOptions<Model>>
  readonly http?: HttpOptions.Input
  readonly cache?: CachePolicy
  /** Stable cache affinity for protocols that support provider-managed prompt caching. */
  readonly promptCacheKey?: string
  readonly metadata?: Record<string, unknown>
  /** Emit a `raw` event with each provider frame before the events parsed from it. */
  readonly includeRaw?: boolean
}

/** An Effect Schema decodes and types `object`; a raw JSON Schema leaves it `unknown`. */
export type OutputSchema = ToolSchema<any> | JsonSchema.JsonSchema

export type OutputType<S extends OutputSchema> = S extends Schema.Top ? Schema.Schema.Type<S> : unknown

export type ObjectResponse<T> = LLMResponse & { readonly object: T }

/** Stream events for a request with `schema`: the `finish` event carries the decoded `object`. */
export type ObjectEvent<T> = Exclude<LLMEvent, Finish> | (Finish & { readonly object: T })

/** Loop events for a request with `schema`: the final step's `finish` event carries the decoded `object`. */
export type LoopObjectEvent<T> = Exclude<LLMEvent, Finish> | (Finish & { readonly object?: T })

/** Run one model call. With `schema`, the model must answer through a forced tool call decoded into `object`. */
export function generate<const Model extends LanguageModel, S extends OutputSchema>(
  input: LLMRequestInput<Model> & { readonly schema: S },
  options?: StreamOptions,
): Effect.Effect<ObjectResponse<OutputType<S>>, AIError, Service>
export function generate<const Model extends LanguageModel>(
  input: LLMRequestInput<Model>,
  options?: StreamOptions,
): Effect.Effect<LLMResponse, AIError, Service>
export function generate(input: Input, options?: StreamOptions) {
  return prepare(input).pipe(
    Effect.flatMap(({ request, output }) =>
      LLMClient.generate(request, options).pipe(
        Effect.flatMap((response) =>
          output === undefined
            ? Effect.succeed(response)
            : decodeObject(output, response).pipe(Effect.map((object) => Object.assign(response, { object }))),
        ),
      ),
    ),
  )
}

/** Stream one model call. With `schema`, the `finish` event carries the decoded `object`. */
export function stream<const Model extends LanguageModel, S extends OutputSchema>(
  input: LLMRequestInput<Model> & { readonly schema: S },
  options?: StreamOptions,
): Stream.Stream<ObjectEvent<OutputType<S>>, AIError, Service>
export function stream<const Model extends LanguageModel>(
  input: LLMRequestInput<Model>,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError, Service>
export function stream(input: Input, options?: StreamOptions) {
  return Stream.unwrap(
    prepare(input).pipe(
      Effect.map(({ request, output }) =>
        Stream.suspend(() => {
          let state = LLMResponse.empty()
          return LLMClient.stream(request, options).pipe(
            Stream.mapEffect((event) => {
              state = LLMResponse.reduce(state, event)
              return output === undefined || event.type !== "finish"
                ? Effect.succeed(event)
                : withObject(output, event, state)
            }),
          )
        }),
      ),
    ),
  )
}

export type LLMLoopInput<Model extends LanguageModel = LanguageModel> = Omit<TextRequestFields<Model>, "tools"> &
  PromptOrMessages & {
    readonly tools: ReadonlyArray<ExecutableTool>
    /** Called after each step that has tool calls; returning `true` ends the loop without running them. */
    readonly until?: (state: { readonly steps: ReadonlyArray<LLMResponse> }) => boolean
  }

/**
 * Stream model calls, running the model's tool calls between them, until a step has no client-executed tool calls,
 * reports a provider error, or `until` returns `true`. Each step's `step-start` and `step-finish` carry its step index.
 * With `schema`, the model ends by calling the hidden answer tool, decoded into `object` on that step's `finish`.
 */
export function loop<const Model extends LanguageModel, S extends OutputSchema>(
  input: LLMLoopInput<Model> & { readonly schema: S },
  options?: StreamOptions,
): Stream.Stream<LoopObjectEvent<OutputType<S>>, AIError, Service>
export function loop<const Model extends LanguageModel>(
  input: LLMLoopInput<Model>,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError, Service>
export function loop(input: LLMLoopInput & { readonly schema?: OutputSchema }, options?: StreamOptions) {
  const { tools, until, ...rest } = input
  // A step that calls the answer tool is final, even if it also called other tools.
  const clientCalls = (response: LLMResponse, output: Tool | undefined) =>
    output && response.toolCalls.some((call) => call.name === OBJECT_TOOL)
      ? []
      : response.toolCalls.filter((call) => call.providerExecuted !== true)
  const step = (
    request: LLMRequest,
    steps: ReadonlyArray<LLMResponse>,
    output: Tool | undefined,
  ): Stream.Stream<LLMEvent, AIError, Service> =>
    Stream.suspend(() => {
      let state = LLMResponse.empty()
      return LLMClient.stream(request, options).pipe(
        Stream.map((event) =>
          event.type === "step-start" || event.type === "step-finish" ? { ...event, index: steps.length } : event,
        ),
        Stream.mapEffect((event) => {
          state = LLMResponse.reduce(state, event)
          if (output === undefined || event.type !== "finish") return Effect.succeed(event)
          const response = LLMResponse.complete(state)
          return response && clientCalls(response, output).length > 0
            ? Effect.succeed(event)
            : withObject(output, event, state)
        }),
        Stream.mapError((error) => withPartial(error, LLMResponse.partial(state))),
        Stream.concat(
          Stream.unwrap(
            Effect.gen(function* () {
              const response = LLMResponse.complete(state)
              const calls = response ? clientCalls(response, output) : []
              if (!response || calls.length === 0 || state.events.some(LLMEvent.is.providerError)) return Stream.empty
              const done = [...steps, response]
              if (until?.({ steps: done })) return Stream.empty
              const results = yield* Effect.forEach(calls, (call) => ToolRuntime.dispatch(tools, call), {
                concurrency: "unbounded",
              })
              const next = {
                ...request,
                messages: [
                  ...request.messages,
                  response.message,
                  ...calls.map((call, i) =>
                    Message.tool({
                      id: call.id,
                      name: call.name,
                      namespace: call.namespace,
                      result: results[i].result,
                      providerMetadata: call.providerMetadata,
                    }),
                  ),
                ],
              }
              return Stream.fromIterable(results.flatMap((result) => result.events)).pipe(
                Stream.concat(step(next, done, output)),
              )
            }),
          ),
        ),
      )
    })
  return Stream.unwrap(prepare({ ...rest, tools }).pipe(Effect.map(({ request, output }) => step(request, [], output))))
}

const OBJECT_TOOL = "generate_object"

type Input = LLMRequestInput & { readonly schema?: OutputSchema }

// `schema` adds a hidden tool whose input is the answer. With other tools the model only has to call some tool.
const prepare = (input: Input) => {
  const { schema, ...rest } = input
  return tryRequest(() => {
    const description = "Return the structured result by calling this tool."
    const output: Tool | undefined =
      schema === undefined ? undefined : tool({ name: OBJECT_TOOL, description, input: schema })
    const tools = rest.tools ?? []
    const built = request(
      output === undefined
        ? rest
        : {
            ...rest,
            tools: [...tools, output],
            toolChoice: tools.length === 0 ? ToolChoice.named(OBJECT_TOOL) : new ToolChoice({ type: "required" }),
          },
    )
    const duplicate = built.tools.find(
      (entry, index) => built.tools.findIndex((other) => other.name === entry.name) !== index,
    )
    if (duplicate) throw new Error(`Duplicate tool name: ${duplicate.name}`)
    return { request: built, output }
  })
}

const decodeObject = (output: Tool, response: LLMResponse) => {
  const call = response.toolCalls.find((event) => event.name === OBJECT_TOOL)
  const invalid = (message: string, cause?: unknown) =>
    new AIError({ reason: new InvalidProviderOutputError({ message, cause }), partial: response })
  // A cut-off call arrives with truncated or empty input, so its decode error would hide the real cause.
  if (response.finishReason.normalized === "length")
    return Effect.fail(invalid("output hit the token limit before the forced tool call completed"))
  if (call)
    return output
      ._decode(call.input)
      .pipe(Effect.mapError((error) => invalid(`schema decode failed: ${error.message}`, error)))
  return Effect.fail(invalid(`model did not call the forced \`${OBJECT_TOOL}\` tool`))
}

const withObject = (output: Tool, event: Finish, state: LLMResponse.State): Effect.Effect<LLMEvent, AIError> => {
  const response = LLMResponse.complete(state)
  return response === undefined
    ? Effect.succeed(event)
    : decodeObject(output, response).pipe(Effect.map((object) => ({ ...event, object })))
}

/** Normalize text request input into a plain `LLMRequest`, with `prompt` turned into the one user message. */
export const request = <const Model extends LanguageModel>(input: LLMRequestInput<Model>): LLMRequest<Model> => {
  if ((input.prompt === undefined) === (input.messages === undefined))
    throw new AIError({
      reason: new InvalidRequestError({ message: "Pass exactly one of `prompt` or `messages`, not both or neither" }),
    })
  return {
    id: input.id,
    model: input.model,
    system: SystemPart.content(input.system),
    messages: input.prompt === undefined ? (input.messages ?? []).map(Message.make) : [Message.user(input.prompt)],
    tools: input.tools?.map((item) => ("_definition" in item ? item._definition : ToolEntry.make(item))) ?? [],
    toolChoice: input.toolChoice ? ToolChoice.make(input.toolChoice) : undefined,
    generation: input.generation === undefined ? undefined : GenerationOptions.make(input.generation),
    providerOptions: input.providerOptions,
    http: HttpOptions.make(input.http),
    cache: input.cache,
    promptCacheKey: input.promptCacheKey,
    metadata: input.metadata,
    includeRaw: input.includeRaw,
  }
}

/** Compact a text request: a replacement window, or a checkpoint with `mechanism: "trigger"`. */
export function compact(
  input: CheckpointRequest,
  options: TriggerCompactOptions,
): Effect.Effect<CompactionCheckpointResponse, AIError, Service>
export function compact(
  input: CompactionRequest,
  options?: EndpointCompactOptions,
): Effect.Effect<CompactionResponse, AIError, Service>
export function compact(
  input: CheckpointRequest | CompactionRequest,
  options?: EndpointCompactOptions | TriggerCompactOptions,
) {
  return tryRequest(() => request<LanguageModel>(input)).pipe(
    Effect.flatMap((normalized) => compactRequest(normalized, options)),
  )
}

export { canCompact }

export * as LLM from "./llm.js"
