import { Schema } from "effect"
import { FinishReason, ProtocolID, ProviderMetadata, RouteID } from "./ids"
import { ModelRef } from "./options"
import { ToolResultValue } from "./messages"

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
  body: Schema.Unknown,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/**
 * A `PreparedRequest` whose `body` is typed as `Body`. Use with the generic
 * on `LLMClient.prepare<Body>(...)` when the caller knows which route their
 * request will resolve to and wants its native shape statically exposed
 * (debug UIs, request previews, plan rendering).
 *
 * The runtime body is identical — the route still emits `body: unknown` — so
 * this is a type-level assertion the caller makes about what they expect to
 * find. The prepare runtime does not validate the assertion.
 */
export type PreparedRequestOf<Body> = Omit<PreparedRequest, "body"> & {
  readonly body: Body
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
