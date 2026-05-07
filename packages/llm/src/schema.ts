import { Schema } from "effect"

/** Stable string identifier for a protocol implementation. */
export const ProtocolID = Schema.String
export type ProtocolID = Schema.Schema.Type<typeof ProtocolID>

/** Stable string identifier for the runnable route. */
export const RouteID = Schema.String
export type RouteID = Schema.Schema.Type<typeof RouteID>

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

export const ProviderMetadata = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const mergeJsonRecords = (...items: ReadonlyArray<Record<string, unknown> | undefined>): Record<string, unknown> | undefined => {
  const defined = items.filter((item): item is Record<string, unknown> => item !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1 && Object.values(defined[0]).every((value) => value !== undefined)) return defined[0]
  const result: Record<string, unknown> = {}
  for (const item of defined) {
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) continue
      result[key] = isRecord(result[key]) && isRecord(value) ? mergeJsonRecords(result[key], value) : value
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

const mergeStringRecords = (...items: ReadonlyArray<Record<string, string> | undefined>): Record<string, string> | undefined => {
  const defined = items.filter((item): item is Record<string, string> => item !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  const result = Object.fromEntries(
    defined.flatMap((item) => Object.entries(item).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  )
  return Object.keys(result).length === 0 ? undefined : result
}

export const ProviderOptions = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
export type ProviderOptions = Schema.Schema.Type<typeof ProviderOptions>

export const mergeProviderOptions = (...items: ReadonlyArray<ProviderOptions | undefined>): ProviderOptions | undefined => {
  const result: Record<string, Record<string, unknown>> = {}
  for (const item of items) {
    if (!item) continue
    for (const [provider, options] of Object.entries(item)) {
      const merged = mergeJsonRecords(result[provider], options)
      if (merged) result[provider] = merged
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export class HttpOptions extends Schema.Class<HttpOptions>("LLM.HttpOptions")({
  body: Schema.optional(JsonSchema),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  query: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export namespace HttpOptions {
  export type Input = HttpOptions | ConstructorParameters<typeof HttpOptions>[0]

  /** Normalize HTTP option input into the canonical `HttpOptions` class. */
  export const make = (input: Input) => input instanceof HttpOptions ? input : new HttpOptions(input)
}

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

export namespace GenerationOptions {
  export type Input = GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0]

  /** Normalize generation option input into the canonical `GenerationOptions` class. */
  export const make = (input: Input = {}) => input instanceof GenerationOptions ? input : new GenerationOptions(input)
}

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

export namespace ModelCapabilities {
  export type Input = ModelCapabilities | {
    readonly input?: Partial<ModelCapabilities["input"]>
    readonly output?: Partial<ModelCapabilities["output"]>
    readonly tools?: Partial<ModelCapabilities["tools"]>
    readonly cache?: Partial<ModelCapabilities["cache"]>
    readonly reasoning?: Partial<Omit<ModelCapabilities["reasoning"], "efforts">> & {
      readonly efforts?: ReadonlyArray<ModelCapabilities["reasoning"]["efforts"][number]>
    }
  }

  /** Normalize partial capability input into the canonical capability set. */
  export const make = (input: Input | undefined) => {
    if (input instanceof ModelCapabilities) return input
    return new ModelCapabilities({
      input: { text: true, image: false, audio: false, video: false, pdf: false, ...input?.input },
      output: { text: true, reasoning: false, ...input?.output },
      tools: { calls: false, streamingInput: false, providerExecuted: false, ...input?.tools },
      cache: { prompt: false, messageBlocks: false, contentBlocks: false, ...input?.cache },
      reasoning: { efforts: [], summaries: false, encryptedContent: false, ...input?.reasoning },
    })
  }
}

export class ModelLimits extends Schema.Class<ModelLimits>("LLM.ModelLimits")({
  context: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
}) {}

export namespace ModelLimits {
  export type Input = ModelLimits | ConstructorParameters<typeof ModelLimits>[0]

  /** Normalize model limit input into the canonical `ModelLimits` class. */
  export const make = (input: Input | undefined) => input instanceof ModelLimits ? input : new ModelLimits(input ?? {})
}

export class ModelRef extends Schema.Class<ModelRef>("LLM.ModelRef")({
  id: ModelID,
  provider: ProviderID,
  route: RouteID,
  baseURL: Schema.optional(Schema.String),
  /** Provider-specific API key convenience. Provider helpers normalize this into `auth`. */
  apiKey: Schema.optional(Schema.String),
  /** Optional transport auth policy. Opaque because it may contain functions. */
  auth: Schema.optional(Schema.Any),
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
   * one route should grow into a typed field instead.
   */
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export namespace ModelRef {
  export type Input = ConstructorParameters<typeof ModelRef>[0]

  export const input = (model: ModelRef): Input => ({
    id: model.id,
    provider: model.provider,
    route: model.route,
    baseURL: model.baseURL,
    apiKey: model.apiKey,
    auth: model.auth,
    headers: model.headers,
    queryParams: model.queryParams,
    capabilities: model.capabilities,
    limits: model.limits,
    generation: model.generation,
    providerOptions: model.providerOptions,
    http: model.http,
    native: model.native,
  })

  export const update = (model: ModelRef, patch: Partial<Input>) => {
    if (Object.keys(patch).length === 0) return model
    return new ModelRef({
      ...input(model),
      ...patch,
    })
  }
}

export class CacheHint extends Schema.Class<CacheHint>("LLM.CacheHint")({
  type: Schema.Literals(["ephemeral", "persistent"]),
  ttlSeconds: Schema.optional(Schema.Number),
}) {}

const systemPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.SystemPart" })
export type SystemPart = Schema.Schema.Type<typeof systemPartSchema>

const makeSystemPart = (text: string): SystemPart => ({ type: "text", text })

export const SystemPart = Object.assign(systemPartSchema, {
  make: makeSystemPart,
  content: (input?: string | SystemPart | ReadonlyArray<SystemPart>) => {
    if (input === undefined) return []
    return typeof input === "string" ? [makeSystemPart(input)] : Array.isArray(input) ? [...input] : [input]
  },
})

export const TextPart = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
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
  providerMetadata: Schema.optional(ProviderMetadata),
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
  providerMetadata: Schema.optional(ProviderMetadata),
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
    providerMetadata: input.providerMetadata,
  }),
})
export type ToolResultPart = Schema.Schema.Type<typeof ToolResultPart>

export const ReasoningPart = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  encrypted: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
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

export namespace ToolDefinition {
  export type Input = ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]

  /** Normalize tool definition input into the canonical `ToolDefinition` class. */
  export const make = (input: Input) => input instanceof ToolDefinition ? input : new ToolDefinition(input)
}

export class ToolChoice extends Schema.Class<ToolChoice>("LLM.ToolChoice")({
  type: Schema.Literals(["auto", "none", "required", "tool"]),
  name: Schema.optional(Schema.String),
}) {}

export namespace ToolChoice {
  export type Mode = Exclude<ToolChoice["type"], "tool">
  export type Input = ToolChoice | ConstructorParameters<typeof ToolChoice>[0] | ToolDefinition | string

  const isMode = (value: string): value is Mode =>
    value === "auto" || value === "none" || value === "required"

  /** Select a specific named tool. */
  export const named = (value: string) => new ToolChoice({ type: "tool", name: value })

  /** Normalize ergonomic tool-choice inputs into the canonical `ToolChoice` class. */
  export const make = (input: Input) => {
    if (input instanceof ToolChoice) return input
    if (input instanceof ToolDefinition) return named(input.name)
    if (typeof input === "string") return isMode(input) ? new ToolChoice({ type: input }) : named(input)
    return new ToolChoice(input)
  }
}

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
  generation: Schema.optional(GenerationOptions),
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
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextStart" })
export type TextStart = Schema.Schema.Type<typeof TextStart>

export const TextDelta = Schema.Struct({
  type: Schema.Literal("text-delta"),
  id: Schema.optional(Schema.String),
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextDelta" })
export type TextDelta = Schema.Schema.Type<typeof TextDelta>

export const TextEnd = Schema.Struct({
  type: Schema.Literal("text-end"),
  id: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextEnd" })
export type TextEnd = Schema.Schema.Type<typeof TextEnd>

export const ReasoningDelta = Schema.Struct({
  type: Schema.Literal("reasoning-delta"),
  id: Schema.optional(Schema.String),
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ReasoningDelta" })
export type ReasoningDelta = Schema.Schema.Type<typeof ReasoningDelta>

export const ToolInputDelta = Schema.Struct({
  type: Schema.Literal("tool-input-delta"),
  id: Schema.String,
  name: Schema.String,
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolInputDelta" })
export type ToolInputDelta = Schema.Schema.Type<typeof ToolInputDelta>

export const ToolCall = Schema.Struct({
  type: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolCall" })
export type ToolCall = Schema.Schema.Type<typeof ToolCall>

export const ToolResult = Schema.Struct({
  type: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: ToolResultValue,
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolResult" })
export type ToolResult = Schema.Schema.Type<typeof ToolResult>

export const ToolError = Schema.Struct({
  type: Schema.Literal("tool-error"),
  id: Schema.String,
  name: Schema.String,
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolError" })
export type ToolError = Schema.Schema.Type<typeof ToolError>

export const StepFinish = Schema.Struct({
  type: Schema.Literal("step-finish"),
  index: Schema.Number,
  reason: FinishReason,
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.StepFinish" })
export type StepFinish = Schema.Schema.Type<typeof StepFinish>

export const RequestFinish = Schema.Struct({
  type: Schema.Literal("request-finish"),
  reason: FinishReason,
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.RequestFinish" })
export type RequestFinish = Schema.Schema.Type<typeof RequestFinish>

export const ProviderErrorEvent = Schema.Struct({
  type: Schema.Literal("provider-error"),
  message: Schema.String,
  retryable: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
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
  route: RouteID,
  protocol: ProtocolID,
  model: ModelRef,
  payload: Schema.Unknown,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/**
 * A `PreparedRequest` whose `payload` is typed as `Payload`. Use with the
 * generic on `LLMClient.prepare<Payload>(...)` when the caller knows which
 * route their request will resolve to and wants its native shape statically
 * exposed (debug UIs, request previews, plan rendering).
 *
 * The runtime payload is identical — the route still emits `payload: unknown`
 * — so this is a type-level assertion the caller makes about what they expect
 * to find. The prepare runtime does not validate the assertion.
 */
export type PreparedRequestOf<Payload> = Omit<PreparedRequest, "payload"> & {
  readonly payload: Payload
}

const responseText = (events: ReadonlyArray<LLMEvent>) =>
  events
    .filter(LLMEvent.is.textDelta)
    .map((event) => event.text)
    .join("")

const responseReasoning = (events: ReadonlyArray<LLMEvent>) =>
  events
    .filter(LLMEvent.is.reasoningDelta)
    .map((event) => event.text)
    .join("")

const responseUsage = (events: ReadonlyArray<LLMEvent>) =>
  events.reduce<Usage | undefined>(
    (usage, event) => ("usage" in event && event.usage !== undefined ? event.usage : usage),
    undefined,
  )

export class LLMResponse extends Schema.Class<LLMResponse>("LLM.Response")({
  events: Schema.Array(LLMEvent),
  usage: Schema.optional(Usage),
}) {
  /** Concatenated assistant text assembled from streamed `text-delta` events. */
  get text() {
    return responseText(this.events)
  }

  /** Concatenated reasoning text assembled from streamed `reasoning-delta` events. */
  get reasoning() {
    return responseReasoning(this.events)
  }

  /** Completed tool calls emitted by the provider. */
  get toolCalls() {
    return this.events.filter(LLMEvent.is.toolCall)
  }
}

export namespace LLMResponse {
  export type Output = LLMResponse | { readonly events: ReadonlyArray<LLMEvent>; readonly usage?: Usage }

  /** Concatenate assistant text from a response or collected event list. */
  export const text = (response: Output) => responseText(response.events)

  /** Return response usage, falling back to the latest usage-bearing event. */
  export const usage = (response: Output) => response.usage ?? responseUsage(response.events)

  /** Return completed tool calls from a response or collected event list. */
  export const toolCalls = (response: Output) => response.events.filter(LLMEvent.is.toolCall)

  /** Concatenate reasoning text from a response or collected event list. */
  export const reasoning = (response: Output) => responseReasoning(response.events)
}

export class HttpRequestDetails extends Schema.Class<HttpRequestDetails>("LLM.HttpRequestDetails")({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpResponseDetails extends Schema.Class<HttpResponseDetails>("LLM.HttpResponseDetails")({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpRateLimitDetails extends Schema.Class<HttpRateLimitDetails>("LLM.HttpRateLimitDetails")({
  retryAfterMs: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  remaining: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  reset: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class HttpContext extends Schema.Class<HttpContext>("LLM.HttpContext")({
  request: HttpRequestDetails,
  response: Schema.optional(HttpResponseDetails),
  body: Schema.optional(Schema.String),
  bodyTruncated: Schema.optional(Schema.Boolean),
  requestId: Schema.optional(Schema.String),
  rateLimit: Schema.optional(HttpRateLimitDetails),
}) {}

export class InvalidRequestReason extends Schema.Class<InvalidRequestReason>("LLM.Error.InvalidRequest")({
  _tag: Schema.tag("InvalidRequest"),
  message: Schema.String,
  parameter: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class NoRouteReason extends Schema.Class<NoRouteReason>("LLM.Error.NoRoute")({
  _tag: Schema.tag("NoRoute"),
  route: RouteID,
  provider: ProviderID,
  model: ModelID,
}) {
  get retryable() {
    return false
  }

  get message() {
    return `No LLM route for ${this.provider}/${this.model} using ${this.route}`
  }
}

export class AuthenticationReason extends Schema.Class<AuthenticationReason>("LLM.Error.Authentication")({
  _tag: Schema.tag("Authentication"),
  message: Schema.String,
  kind: Schema.Literals(["missing", "invalid", "expired", "insufficient-permissions", "unknown"]),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class RateLimitReason extends Schema.Class<RateLimitReason>("LLM.Error.RateLimit")({
  _tag: Schema.tag("RateLimit"),
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number),
  rateLimit: Schema.optional(HttpRateLimitDetails),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return true
  }
}

export class QuotaExceededReason extends Schema.Class<QuotaExceededReason>("LLM.Error.QuotaExceeded")({
  _tag: Schema.tag("QuotaExceeded"),
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class ContentPolicyReason extends Schema.Class<ContentPolicyReason>("LLM.Error.ContentPolicy")({
  _tag: Schema.tag("ContentPolicy"),
  message: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class ProviderInternalReason extends Schema.Class<ProviderInternalReason>("LLM.Error.ProviderInternal")({
  _tag: Schema.tag("ProviderInternal"),
  message: Schema.String,
  status: Schema.Number,
  retryAfterMs: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return true
  }
}

export class TransportReason extends Schema.Class<TransportReason>("LLM.Error.Transport")({
  _tag: Schema.tag("Transport"),
  message: Schema.String,
  kind: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export class InvalidProviderOutputReason extends Schema.Class<InvalidProviderOutputReason>("LLM.Error.InvalidProviderOutput")({
  _tag: Schema.tag("InvalidProviderOutput"),
  message: Schema.String,
  route: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get retryable() {
    return false
  }
}

export class UnknownProviderReason extends Schema.Class<UnknownProviderReason>("LLM.Error.UnknownProvider")({
  _tag: Schema.tag("UnknownProvider"),
  message: Schema.String,
  status: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false
  }
}

export const LLMErrorReason = Schema.Union([
  InvalidRequestReason,
  NoRouteReason,
  AuthenticationReason,
  RateLimitReason,
  QuotaExceededReason,
  ContentPolicyReason,
  ProviderInternalReason,
  TransportReason,
  InvalidProviderOutputReason,
  UnknownProviderReason,
])
export type LLMErrorReason = Schema.Schema.Type<typeof LLMErrorReason>

export class LLMError extends Schema.TaggedErrorClass<LLMError>()("LLM.Error", {
  module: Schema.String,
  method: Schema.String,
  reason: LLMErrorReason,
}) {
  override readonly cause = this.reason

  get retryable() {
    return this.reason.retryable
  }

  get retryAfterMs() {
    return "retryAfterMs" in this.reason ? this.reason.retryAfterMs : undefined
  }

  override get message() {
    return `${this.module}.${this.method}: ${this.reason.message}`
  }
}

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
