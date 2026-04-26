import { Schema } from "effect"

export const Protocol = Schema.Literals([
  "openai-chat",
  "openai-compatible-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini",
  "bedrock-converse",
])
export type Protocol = Schema.Schema.Type<typeof Protocol>

export const ModelID = Schema.String.pipe(Schema.brand("LLM.ModelID"))
export type ModelID = typeof ModelID.Type

export const ProviderID = Schema.String.pipe(Schema.brand("LLM.ProviderID"))
export type ProviderID = typeof ProviderID.Type

export const ReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export const ReasoningEffort = Schema.Literals(ReasoningEfforts)
export type ReasoningEffort = Schema.Schema.Type<typeof ReasoningEffort>

export const PatchPhase = Schema.Literals(["request", "prompt", "tool-schema", "target", "stream"])
export type PatchPhase = Schema.Schema.Type<typeof PatchPhase>

export const MessageRole = Schema.Literals(["user", "assistant", "tool"])
export type MessageRole = Schema.Schema.Type<typeof MessageRole>

export const FinishReason = Schema.Literals(["stop", "length", "tool-calls", "content-filter", "error", "unknown"])
export type FinishReason = Schema.Schema.Type<typeof FinishReason>

export const JsonSchema = Schema.Record(Schema.String, Schema.Unknown)
export type JsonSchema = Schema.Schema.Type<typeof JsonSchema>

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
  protocol: Protocol,
  baseURL: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  capabilities: ModelCapabilities,
  limits: ModelLimits,
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

export const ToolResultValue = Schema.Struct({
  type: Schema.Literals(["json", "text", "error"]),
  value: Schema.Unknown,
}).annotate({ identifier: "LLM.ToolResult" })
export type ToolResultValue = Schema.Schema.Type<typeof ToolResultValue>

export const ToolCallPart = Schema.Struct({
  type: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  providerExecuted: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.ToolCall" })
export type ToolCallPart = Schema.Schema.Type<typeof ToolCallPart>

export const ToolResultPart = Schema.Struct({
  type: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: ToolResultValue,
  providerExecuted: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.ToolResult" })
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

export class GenerationOptions extends Schema.Class<GenerationOptions>("LLM.GenerationOptions")({
  maxTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  stop: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class ReasoningIntent extends Schema.Class<ReasoningIntent>("LLM.ReasoningIntent")({
  enabled: Schema.Boolean,
  effort: Schema.optional(ReasoningEffort),
  summary: Schema.optional(Schema.Boolean),
  encryptedContent: Schema.optional(Schema.Boolean),
}) {}

export class CacheIntent extends Schema.Class<CacheIntent>("LLM.CacheIntent")({
  enabled: Schema.Boolean,
  key: Schema.optional(Schema.String),
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
  reasoning: Schema.optional(ReasoningIntent),
  cache: Schema.optional(CacheIntent),
  responseFormat: Schema.optional(ResponseFormat),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

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

export const LLMEvent = Schema.Union([
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
export type LLMEvent = Schema.Schema.Type<typeof LLMEvent>

export class PatchTrace extends Schema.Class<PatchTrace>("LLM.PatchTrace")({
  id: Schema.String,
  phase: PatchPhase,
  reason: Schema.String,
}) {}

export class PreparedRequest extends Schema.Class<PreparedRequest>("LLM.PreparedRequest")({
  id: Schema.String,
  adapter: Schema.String,
  model: ModelRef,
  target: Schema.Unknown,
  redactedTarget: Schema.Unknown,
  patchTrace: Schema.Array(PatchTrace),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class LLMResponse extends Schema.Class<LLMResponse>("LLM.Response")({
  events: Schema.Array(LLMEvent),
  usage: Schema.optional(Usage),
}) {}

export class InvalidRequestError extends Schema.TaggedErrorClass<InvalidRequestError>()("LLM.InvalidRequestError", {
  message: Schema.String,
}) {}

export class NoAdapterError extends Schema.TaggedErrorClass<NoAdapterError>()("LLM.NoAdapterError", {
  protocol: Protocol,
  provider: ProviderID,
  model: ModelID,
}) {
  override get message() {
    return `No LLM adapter for ${this.provider}/${this.model} using ${this.protocol}`
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
