import { Schema } from "effect"

/**
 * Stable string identifier for a protocol implementation. The discriminator
 * value lives on `ModelRef.protocol` and on the `Adapter.protocol` field. This
 * describes the wire semantics: payload lowering, chunk decoding, and stream
 * parsing. Runtime lookup uses `AdapterID` instead.
 */
export const ProtocolID = Schema.String
export type ProtocolID = Schema.Schema.Type<typeof ProtocolID>

/** Stable string identifier for the runnable adapter route. */
export const AdapterID = Schema.String
export type AdapterID = Schema.Schema.Type<typeof AdapterID>

export const ModelID = Schema.String.pipe(Schema.brand("LLM.ModelID"))
export type ModelID = typeof ModelID.Type

export const ProviderID = Schema.String.pipe(Schema.brand("LLM.ProviderID"))
export type ProviderID = typeof ProviderID.Type

export const ReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export const ReasoningEffort = Schema.Literals(ReasoningEfforts)
export type ReasoningEffort = Schema.Schema.Type<typeof ReasoningEffort>

export const TextVerbosity = Schema.Literals(["low", "medium", "high"])
export type TextVerbosity = Schema.Schema.Type<typeof TextVerbosity>

export const MessageRole = Schema.Literals(["user", "assistant", "tool"])
export type MessageRole = Schema.Schema.Type<typeof MessageRole>

export const FinishReason = Schema.Literals(["stop", "length", "tool-calls", "content-filter", "error", "unknown"])
export type FinishReason = Schema.Schema.Type<typeof FinishReason>

export const JsonSchema = Schema.Record(Schema.String, Schema.Unknown)
export type JsonSchema = Schema.Schema.Type<typeof JsonSchema>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const mergeJsonRecords = (...items: ReadonlyArray<Record<string, unknown> | undefined>): Record<string, unknown> | undefined => {
  const result: Record<string, unknown> = items.reduce<Record<string, unknown>>((acc, item) => {
    if (!item) return acc
    return Object.entries(item).reduce<Record<string, unknown>>((next, [key, value]) => {
      if (value === undefined) return next
      return {
        ...next,
        [key]: isRecord(next[key]) && isRecord(value) ? mergeJsonRecords(next[key], value) : value,
      }
    }, acc)
  }, {})
  return Object.keys(result).length === 0 ? undefined : result
}

const mergeStringRecords = (...items: ReadonlyArray<Record<string, string> | undefined>): Record<string, string> | undefined => {
  const result = Object.fromEntries(
    items.flatMap((item) => Object.entries(item ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  )
  return Object.keys(result).length === 0 ? undefined : result
}

export const ProviderOptions = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
export type ProviderOptions = Schema.Schema.Type<typeof ProviderOptions>

export const mergeProviderOptions = (...items: ReadonlyArray<ProviderOptions | undefined>): ProviderOptions | undefined => {
  const result = Object.fromEntries(
    Object.entries(
      items.reduce<Record<string, Record<string, unknown>>>((acc, item) => {
        if (!item) return acc
        return Object.entries(item).reduce<Record<string, Record<string, unknown>>>((next, [provider, options]) => ({
          ...next,
          [provider]: mergeJsonRecords(next[provider], options) ?? {},
        }), acc)
      }, {}),
    ).filter((entry) => Object.keys(entry[1]).length > 0),
  )
  return Object.keys(result).length === 0 ? undefined : result
}

export class HttpOptions extends Schema.Class<HttpOptions>("LLM.HttpOptions")({
  body: Schema.optional(JsonSchema),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  query: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const mergeHttpOptions = (...items: ReadonlyArray<HttpOptions | undefined>): HttpOptions | undefined => {
  const body = mergeJsonRecords(...items.map((item) => item?.body))
  const headers = mergeStringRecords(...items.map((item) => item?.headers))
  const query = mergeStringRecords(...items.map((item) => item?.query))
  if (!body && !headers && !query) return undefined
  return new HttpOptions({ body, headers, query })
}

export class GenerationOptions extends Schema.Class<GenerationOptions>("LLM.GenerationOptions")({
  maxTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  frequencyPenalty: Schema.optional(Schema.Number),
  presencePenalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stop: Schema.optional(Schema.Array(Schema.String)),
}) {}

export type GenerationOptionsFields = {
  readonly maxTokens?: number
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly frequencyPenalty?: number
  readonly presencePenalty?: number
  readonly seed?: number
  readonly stop?: ReadonlyArray<string>
}

export type GenerationOptionsInput = GenerationOptions | GenerationOptionsFields

const latestGeneration = <Key extends keyof GenerationOptionsFields>(
  items: ReadonlyArray<GenerationOptionsInput | undefined>,
  key: Key,
) => items.findLast((item) => item?.[key] !== undefined)?.[key]

export const mergeGenerationOptions = (...items: ReadonlyArray<GenerationOptionsInput | undefined>) => {
  const result = new GenerationOptions({
    maxTokens: latestGeneration(items, "maxTokens"),
    temperature: latestGeneration(items, "temperature"),
    topP: latestGeneration(items, "topP"),
    topK: latestGeneration(items, "topK"),
    frequencyPenalty: latestGeneration(items, "frequencyPenalty"),
    presencePenalty: latestGeneration(items, "presencePenalty"),
    seed: latestGeneration(items, "seed"),
    stop: latestGeneration(items, "stop"),
  })
  return Object.values(result).some((value) => value !== undefined) ? result : undefined
}

export class ModelCapabilities extends Schema.Class<ModelCapabilities>("LLM.ModelCapabilities")({
  input: Schema.Struct({
    text: Schema.Boolean,
    image: Schema.Boolean,
    audio: Schema.Boolean,
    video: Schema.Boolean,
    pdf: Schema.Boolean,
  }),
  output: Schema.Struct({
    text: Schema.Boolean,
    reasoning: Schema.Boolean,
  }),
  tools: Schema.Struct({
    calls: Schema.Boolean,
    streamingInput: Schema.Boolean,
    providerExecuted: Schema.Boolean,
  }),
  cache: Schema.Struct({
    prompt: Schema.Boolean,
    messageBlocks: Schema.Boolean,
    contentBlocks: Schema.Boolean,
  }),
  reasoning: Schema.Struct({
    efforts: Schema.Array(ReasoningEffort),
    summaries: Schema.Boolean,
    encryptedContent: Schema.Boolean,
  }),
}) {}

export class ModelLimits extends Schema.Class<ModelLimits>("LLM.ModelLimits")({
  context: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
}) {}

export class ModelRef extends Schema.Class<ModelRef>("LLM.ModelRef")({
  id: ModelID,
  provider: ProviderID,
  adapter: AdapterID,
  protocol: ProtocolID,
  baseURL: Schema.optional(Schema.String),
  /**
   * Auth secret read by `Auth.bearer` / `Auth.apiKeyHeader` at request time.
   * Lives here so authentication is not baked into `headers` at construction
   * time and the `Auth` axis can actually do its job per request.
   */
  apiKey: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /**
   * Query params appended to the request URL by `Endpoint.baseURL`. Used for
   * deployment-level URL-scoped settings such as Azure's `api-version` or any
   * provider that requires a per-request key in the URL. Generic concern, so
   * lives as a typed first-class field instead of `native`.
   */
  queryParams: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  capabilities: ModelCapabilities,
  limits: ModelLimits,
  /** Provider-neutral generation defaults. Request-level values override them. */
  generation: Schema.optional(GenerationOptions),
  /** Provider-owned typed-at-the-facade options for non-portable knobs. */
  providerOptions: Schema.optional(ProviderOptions),
  /** Serializable raw HTTP overlays applied to the final outgoing request. */
  http: Schema.optional(HttpOptions),
  /**
   * Provider-specific opaque options. Reach for this only when the value is
   * genuinely provider-private and does not fit a typed axis (e.g. Bedrock's
   * `aws_credentials` / `aws_region` for SigV4). Anything used by more than
   * one adapter should grow into a typed field instead.
   */
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class CacheHint extends Schema.Class<CacheHint>("LLM.CacheHint")({
  type: Schema.Literals(["ephemeral", "persistent"]),
  ttlSeconds: Schema.optional(Schema.Number),
}) {}

export const SystemPart = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.SystemPart" })
export type SystemPart = Schema.Schema.Type<typeof SystemPart>

export const TextPart = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.Text" })
export type TextPart = Schema.Schema.Type<typeof TextPart>

export const MediaPart = Schema.Struct({
  type: Schema.Literal("media"),
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8Array]),
  filename: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.Media" })
export type MediaPart = Schema.Schema.Type<typeof MediaPart>

const isToolResultValue = (value: unknown): value is ToolResultValue =>
  isRecord(value) && (value.type === "text" || value.type === "json" || value.type === "error") && "value" in value

export const ToolResultValue = Object.assign(Schema.Struct({
  type: Schema.Literals(["json", "text", "error"]),
  value: Schema.Unknown,
}).annotate({ identifier: "LLM.ToolResult" }), {
  make: (value: unknown, type: ToolResultValue["type"] = "json"): ToolResultValue =>
    isToolResultValue(value) ? value : { type, value },
})
export type ToolResultValue = Schema.Schema.Type<typeof ToolResultValue>

export const ToolCallPart = Object.assign(Schema.Struct({
  type: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  providerExecuted: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.ToolCall" }), {
  make: (input: Omit<ToolCallPart, "type">): ToolCallPart => ({ type: "tool-call", ...input }),
})
export type ToolCallPart = Schema.Schema.Type<typeof ToolCallPart>

export const ToolResultPart = Object.assign(Schema.Struct({
  type: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: ToolResultValue,
  providerExecuted: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.ToolResult" }), {
  make: (input: Omit<ToolResultPart, "type" | "result"> & {
    readonly result: unknown
    readonly resultType?: ToolResultValue["type"]
  }): ToolResultPart => ({
    type: "tool-result",
    id: input.id,
    name: input.name,
    result: ToolResultValue.make(input.result, input.resultType),
    providerExecuted: input.providerExecuted,
    metadata: input.metadata,
  }),
})
export type ToolResultPart = Schema.Schema.Type<typeof ToolResultPart>

export const ReasoningPart = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  encrypted: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.Reasoning" })
export type ReasoningPart = Schema.Schema.Type<typeof ReasoningPart>

export const ContentPart = Schema.Union([TextPart, MediaPart, ToolCallPart, ToolResultPart, ReasoningPart]).pipe(
  Schema.toTaggedUnion("type"),
)
export type ContentPart = Schema.Schema.Type<typeof ContentPart>

export class Message extends Schema.Class<Message>("LLM.Message")({
  id: Schema.optional(Schema.String),
  role: MessageRole,
  content: Schema.Array(ContentPart),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export namespace Message {
  export type ContentInput = string | ContentPart | ReadonlyArray<ContentPart>
  export type Input = Omit<ConstructorParameters<typeof Message>[0], "content"> & {
    readonly content: ContentInput
  }

  export const text = (value: string): ContentPart => ({ type: "text", text: value })

  export const content = (input: ContentInput) =>
    typeof input === "string" ? [text(input)] : Array.isArray(input) ? [...input] : [input]

  export const make = (input: Message | Input) => {
    if (input instanceof Message) return input
    return new Message({ ...input, content: content(input.content) })
  }

  export const user = (content: ContentInput) => make({ role: "user", content })

  export const assistant = (content: ContentInput) => make({ role: "assistant", content })

  export const tool = (result: ToolResultPart | Parameters<typeof ToolResultPart.make>[0]) =>
    make({ role: "tool", content: ["type" in result ? result : ToolResultPart.make(result)] })
}

export class ToolDefinition extends Schema.Class<ToolDefinition>("LLM.ToolDefinition")({
  name: Schema.String,
  description: Schema.String,
  inputSchema: JsonSchema,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class ToolChoice extends Schema.Class<ToolChoice>("LLM.ToolChoice")({
  type: Schema.Literals(["auto", "none", "required", "tool"]),
  name: Schema.optional(Schema.String),
}) {}

export const ResponseFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text") }),
  Schema.Struct({ type: Schema.Literal("json"), schema: JsonSchema }),
  Schema.Struct({ type: Schema.Literal("tool"), tool: ToolDefinition }),
])
export type ResponseFormat = Schema.Schema.Type<typeof ResponseFormat>

export class LLMRequest extends Schema.Class<LLMRequest>("LLM.Request")({
  id: Schema.optional(Schema.String),
  model: ModelRef,
  system: Schema.Array(SystemPart),
  messages: Schema.Array(Message),
  tools: Schema.Array(ToolDefinition),
  toolChoice: Schema.optional(ToolChoice),
  generation: GenerationOptions,
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
  responseFormat: Schema.optional(ResponseFormat),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export namespace LLMRequest {
  export type Input = ConstructorParameters<typeof LLMRequest>[0]

  export const input = (request: LLMRequest): Input => ({
    id: request.id,
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
    generation: request.generation,
    providerOptions: request.providerOptions,
    http: request.http,
    responseFormat: request.responseFormat,
    metadata: request.metadata,
  })

  export const update = (request: LLMRequest, patch: Partial<Input>) => {
    if (Object.keys(patch).length === 0) return request
    return new LLMRequest({
      ...input(request),
      ...patch,
      model: patch.model ?? request.model,
    })
  }
}

export class Usage extends Schema.Class<Usage>("LLM.Usage")({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export const RequestStart = Schema.Struct({
  type: Schema.Literal("request-start"),
  id: Schema.String,
  model: ModelRef,
}).annotate({ identifier: "LLM.Event.RequestStart" })
export type RequestStart = Schema.Schema.Type<typeof RequestStart>

export const StepStart = Schema.Struct({
  type: Schema.Literal("step-start"),
  index: Schema.Number,
}).annotate({ identifier: "LLM.Event.StepStart" })
export type StepStart = Schema.Schema.Type<typeof StepStart>

export const TextStart = Schema.Struct({
  type: Schema.Literal("text-start"),
  id: Schema.String,
}).annotate({ identifier: "LLM.Event.TextStart" })
export type TextStart = Schema.Schema.Type<typeof TextStart>

export const TextDelta = Schema.Struct({
  type: Schema.Literal("text-delta"),
  id: Schema.optional(Schema.String),
  text: Schema.String,
}).annotate({ identifier: "LLM.Event.TextDelta" })
export type TextDelta = Schema.Schema.Type<typeof TextDelta>

export const TextEnd = Schema.Struct({
  type: Schema.Literal("text-end"),
  id: Schema.String,
}).annotate({ identifier: "LLM.Event.TextEnd" })
export type TextEnd = Schema.Schema.Type<typeof TextEnd>

export const ReasoningDelta = Schema.Struct({
  type: Schema.Literal("reasoning-delta"),
  id: Schema.optional(Schema.String),
  text: Schema.String,
}).annotate({ identifier: "LLM.Event.ReasoningDelta" })
export type ReasoningDelta = Schema.Schema.Type<typeof ReasoningDelta>

export const ToolInputDelta = Schema.Struct({
  type: Schema.Literal("tool-input-delta"),
  id: Schema.String,
  name: Schema.String,
  text: Schema.String,
}).annotate({ identifier: "LLM.Event.ToolInputDelta" })
export type ToolInputDelta = Schema.Schema.Type<typeof ToolInputDelta>

export const ToolCall = Schema.Struct({
  type: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  providerExecuted: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "LLM.Event.ToolCall" })
export type ToolCall = Schema.Schema.Type<typeof ToolCall>

export const ToolResult = Schema.Struct({
  type: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: ToolResultValue,
  providerExecuted: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "LLM.Event.ToolResult" })
export type ToolResult = Schema.Schema.Type<typeof ToolResult>

export const ToolError = Schema.Struct({
  type: Schema.Literal("tool-error"),
  id: Schema.String,
  name: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "LLM.Event.ToolError" })
export type ToolError = Schema.Schema.Type<typeof ToolError>

export const StepFinish = Schema.Struct({
  type: Schema.Literal("step-finish"),
  index: Schema.Number,
  reason: FinishReason,
  usage: Schema.optional(Usage),
}).annotate({ identifier: "LLM.Event.StepFinish" })
export type StepFinish = Schema.Schema.Type<typeof StepFinish>

export const RequestFinish = Schema.Struct({
  type: Schema.Literal("request-finish"),
  reason: FinishReason,
  usage: Schema.optional(Usage),
}).annotate({ identifier: "LLM.Event.RequestFinish" })
export type RequestFinish = Schema.Schema.Type<typeof RequestFinish>

export const ProviderErrorEvent = Schema.Struct({
  type: Schema.Literal("provider-error"),
  message: Schema.String,
  retryable: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "LLM.Event.ProviderError" })
export type ProviderErrorEvent = Schema.Schema.Type<typeof ProviderErrorEvent>

const llmEventTagged = Schema.Union([
  RequestStart,
  StepStart,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningDelta,
  ToolInputDelta,
  ToolCall,
  ToolResult,
  ToolError,
  StepFinish,
  RequestFinish,
  ProviderErrorEvent,
]).pipe(Schema.toTaggedUnion("type"))

/**
 * camelCase aliases for `LLMEvent.guards` (provided by `Schema.toTaggedUnion`).
 * Lets consumers write `events.filter(LLMEvent.is.toolCall)` instead of
 * `events.filter(LLMEvent.guards["tool-call"])`.
 */
export const LLMEvent = Object.assign(llmEventTagged, {
  is: {
    requestStart: llmEventTagged.guards["request-start"],
    stepStart: llmEventTagged.guards["step-start"],
    textStart: llmEventTagged.guards["text-start"],
    textDelta: llmEventTagged.guards["text-delta"],
    textEnd: llmEventTagged.guards["text-end"],
    reasoningDelta: llmEventTagged.guards["reasoning-delta"],
    toolInputDelta: llmEventTagged.guards["tool-input-delta"],
    toolCall: llmEventTagged.guards["tool-call"],
    toolResult: llmEventTagged.guards["tool-result"],
    toolError: llmEventTagged.guards["tool-error"],
    stepFinish: llmEventTagged.guards["step-finish"],
    requestFinish: llmEventTagged.guards["request-finish"],
    providerError: llmEventTagged.guards["provider-error"],
  },
})
export type LLMEvent = Schema.Schema.Type<typeof llmEventTagged>

export class PreparedRequest extends Schema.Class<PreparedRequest>("LLM.PreparedRequest")({
  id: Schema.String,
  adapter: Schema.String,
  model: ModelRef,
  payload: Schema.Unknown,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/**
 * A `PreparedRequest` whose `payload` is typed as `Payload`. Use with the
 * generic on `LLMClient.prepare<Payload>(...)` when the caller knows which
 * adapter their request will resolve to and wants its native shape statically
 * exposed (debug UIs, request previews, plan rendering).
 *
 * The runtime payload is identical — the adapter still emits `payload: unknown`
 * — so this is a type-level assertion the caller makes about what they expect
 * to find. The prepare runtime does not validate the assertion.
 */
export type PreparedRequestOf<Payload> = Omit<PreparedRequest, "payload"> & {
  readonly payload: Payload
}

export class LLMResponse extends Schema.Class<LLMResponse>("LLM.Response")({
  events: Schema.Array(LLMEvent),
  usage: Schema.optional(Usage),
}) {
  get text() {
    return this.events
      .filter(LLMEvent.is.textDelta)
      .map((event) => event.text)
      .join("")
  }

  get reasoning() {
    return this.events
      .filter(LLMEvent.is.reasoningDelta)
      .map((event) => event.text)
      .join("")
  }

  get toolCalls() {
    return this.events.filter(LLMEvent.is.toolCall)
  }
}

export class InvalidRequestError extends Schema.TaggedErrorClass<InvalidRequestError>()("LLM.InvalidRequestError", {
  message: Schema.String,
}) {}

export class NoAdapterError extends Schema.TaggedErrorClass<NoAdapterError>()("LLM.NoAdapterError", {
  adapter: AdapterID,
  protocol: ProtocolID,
  provider: ProviderID,
  model: ModelID,
}) {
  override get message() {
    return `No LLM adapter for ${this.provider}/${this.model} using ${this.adapter} (${this.protocol})`
  }
}

export class ProviderChunkError extends Schema.TaggedErrorClass<ProviderChunkError>()("LLM.ProviderChunkError", {
  adapter: Schema.String,
  message: Schema.String,
  raw: Schema.optional(Schema.String),
}) {}

export class ProviderRequestError extends Schema.TaggedErrorClass<ProviderRequestError>()("LLM.ProviderRequestError", {
  status: Schema.Number,
  message: Schema.String,
  body: Schema.optional(Schema.String),
}) {}

export class TransportError extends Schema.TaggedErrorClass<TransportError>()("LLM.TransportError", {
  message: Schema.String,
  // Optional originating reason — populated for structured HTTP transport
  // failures (e.g. `RequestError`, `ResponseError`, `IsTimeoutError`) so
  // consumers can render the underlying cause without parsing the message.
  reason: Schema.optional(Schema.String),
  // Optional URL of the failing request when the transport layer surfaces it.
  url: Schema.optional(Schema.String),
}) {}

/**
 * Failure type for tool execute handlers. Handlers must map their internal
 * errors to this shape; the runtime catches `ToolFailure`s and surfaces them
 * as `tool-error` events plus a `tool-result` of `type: "error"` so the model
 * can self-correct.
 *
 * Anything thrown or yielded by a handler that is not a `ToolFailure` is
 * treated as a defect and fails the stream.
 */
export class ToolFailure extends Schema.TaggedErrorClass<ToolFailure>()("LLM.ToolFailure", {
  message: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export type LLMError =
  | InvalidRequestError
  | NoAdapterError
  | ProviderChunkError
  | ProviderRequestError
  | TransportError
