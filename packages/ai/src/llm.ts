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
  Usage,
  type ContentPart,
  type LanguageModelProviderOptions,
  type LLMRequest,
  type ToolEntryInput,
  withPartial,
} from "./schema/index.js"
import { tool, type ExecutableTool, type Tool, type ToolSchema } from "./tool.js"
import { runTools } from "./tool-runtime.js"
import { addUsage, nextRequest, pendingCalls } from "./loop.js"

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

/** Loop events for a request with `schema`: the loop's `finish` event carries the decoded `object`. */
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

/**
 * Stream one model call. The `finish` event carries the assistant `message` and `usage`; with `schema`, also the
 * decoded `object`.
 */
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
        stepStream(request, undefined, options, (step) =>
          Stream.fromEffect(finishStep(step, step.response.usage, output)),
        ),
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
 * hits the output token limit, or `until` returns `true`. Tool calls whose input is not valid JSON get an error result
 * so the model can retry. A forced `toolChoice` applies to the first step only. Each step's `step-start` and `step-finish` carry its step index and usage; one `finish` ends
 * the loop with the final step's reason and `message` and the usage summed across steps. With `schema`, the model ends
 * by calling the hidden answer tool, decoded into `object` on the `finish`.
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
  return Stream.unwrap(
    prepare({ ...rest, tools }).pipe(
      Effect.map(({ request, output }) => driveLoop({ tools, until, output, options }, request, [], undefined)),
    ),
  )
}

export { collect, type Collected, type CollectResult } from "./loop.js"

interface Step {
  readonly response: LLMResponse
  readonly finish: Finish
}

/**
 * Stream one model call. Its `finish` is held back: `after` gets the completed step and streams what follows it.
 * With `index`, the step's `step-start` and `step-finish` carry it.
 */
const stepStream = (
  request: LLMRequest,
  index: number | undefined,
  options: StreamOptions | undefined,
  after: (step: Step) => Stream.Stream<LLMEvent, AIError, Service>,
): Stream.Stream<LLMEvent, AIError, Service> =>
  Stream.suspend(() => {
    let state = LLMResponse.empty()
    let finish: Finish | undefined
    return LLMClient.stream(request, options).pipe(
      Stream.map((event) =>
        index !== undefined && (event.type === "step-start" || event.type === "step-finish")
          ? { ...event, index }
          : event,
      ),
      Stream.tap((event) =>
        Effect.sync(() => {
          state = LLMResponse.reduce(state, event)
          if (event.type === "finish") finish = event
        }),
      ),
      Stream.filter((event) => event.type !== "finish"),
      Stream.mapError((error) => withPartial(error, LLMResponse.partial(state))),
      Stream.concat(
        Stream.suspend(() => {
          const response = LLMResponse.complete(state)
          return response && finish ? after({ response, finish }) : Stream.empty
        }),
      ),
    )
  })

/** The `finish` that ends a stream or loop: the final step's `message`, the given `usage`, and the decoded `object`. */
const finishStep = (
  step: Step,
  usage: Usage | undefined,
  output: Tool | undefined,
): Effect.Effect<LLMEvent, AIError> => {
  const event: Finish = { ...step.finish, usage, message: step.response.message }
  if (output === undefined) return Effect.succeed(event)
  return decodeObject(output, step.response).pipe(Effect.map((object) => ({ ...event, object })))
}

interface LoopContext {
  readonly tools: ReadonlyArray<ExecutableTool>
  readonly until: LLMLoopInput["until"]
  readonly output: Tool | undefined
  readonly options: StreamOptions | undefined
}

const driveLoop = (
  context: LoopContext,
  request: LLMRequest,
  steps: ReadonlyArray<LLMResponse>,
  usage: Usage | undefined,
): Stream.Stream<LLMEvent, AIError, Service> =>
  stepStream(request, steps.length, context.options, (step) => {
    const total = addUsage(usage, step.response.usage)
    const calls = pendingCalls(step.response, context.output && OBJECT_TOOL)
    const done = [...steps, step.response]
    if (calls.length === 0 || context.until?.({ steps: done }))
      return Stream.fromEffect(finishStep(step, total, calls.length === 0 ? context.output : undefined))
    return Stream.unwrap(
      runTools(context.tools, calls).pipe(
        Effect.map((results) =>
          Stream.fromIterable(results.flatMap((result) => result.events)).pipe(
            Stream.concat(
              driveLoop(
                context,
                nextRequest(request, step.response, calls, results, context.output !== undefined),
                done,
                total,
              ),
            ),
          ),
        ),
      ),
    )
  })

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
