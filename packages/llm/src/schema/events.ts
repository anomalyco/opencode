import { Schema } from "effect"
import { ContentBlockID, FinishReason, ProtocolID, ProviderMetadata, RouteID, ToolCallID } from "./ids"
import { ModelSchema } from "./options"
import { Message, ToolCallPart, ToolOutput, ToolResultPart, ToolResultValue, type ContentPart } from "./messages"
import { ProviderFailureClassification } from "./errors"

/**
 * Token usage reported by an LLM provider.
 *
 * **Inclusive totals** (match AI SDK / OpenAI / LangChain convention — a
 * reader from any of those ecosystems sees the number they expect):
 *
 * - `inputTokens` — total prompt tokens, *including* cached reads/writes.
 * - `outputTokens` — total output tokens, *including* reasoning.
 * - `totalTokens` — provider-supplied total, or `inputTokens + outputTokens`.
 *
 * **Non-overlapping breakdown** (every field is independently meaningful;
 * consumers never have to subtract):
 *
 * - `nonCachedInputTokens` — the "fresh" portion of the prompt.
 * - `cacheReadInputTokens` — input tokens served from cache.
 * - `cacheWriteInputTokens` — input tokens written to cache.
 * - `reasoningTokens` — subset of `outputTokens` spent on hidden reasoning.
 *
 * **Invariant**: `nonCachedInputTokens + cacheReadInputTokens +
 * cacheWriteInputTokens = inputTokens`, and `reasoningTokens ≤ outputTokens`.
 * Each protocol mapper computes whichever side it doesn't get natively,
 * with `Math.max(0, …)` clamping for defense against provider bugs. Because
 * every breakdown field is stored independently, downstream consumers can
 * read whatever they need (cost-by-category, context-pressure, AI-SDK-style
 * inclusive total) without ever subtracting — eliminating the underflow
 * class of bug where a clamped difference would silently store the wrong
 * value.
 *
 * **Semantics by provider**:
 *
 * - OpenAI Chat / Responses / Gemini / Bedrock: provider reports inclusive
 *   `inputTokens` and an inclusive `outputTokens`; mapper subtracts to
 *   derive the breakdown.
 * - Anthropic: provider reports the breakdown natively (`input_tokens` is
 *   non-cached only); mapper sums to derive the inclusive `inputTokens`.
 *   Anthropic does *not* break extended-thinking out of `output_tokens`, so
 *   `reasoningTokens` is `undefined` and `outputTokens` carries the
 *   combined total — a documented limitation of the Anthropic API.
 *
 * `providerMetadata` always carries the provider's raw usage payload —
 * keyed by provider name (`{ openai: ... }`, `{ anthropic: ... }`, etc.)
 * — for fields we don't normalize and for billing-level audit trails.
 * Matches the same escape-hatch field on `LLMEvent`.
 */
export class Usage extends Schema.Class<Usage>("LLM.Usage")({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  nonCachedInputTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  /**
   * Visible output tokens — `outputTokens` minus `reasoningTokens`, clamped
   * to zero. The one place subtraction happens in this contract; the clamp
   * means a provider reporting `reasoningTokens > outputTokens` produces a
   * harmless zero rather than a negative that crashes downstream schemas.
   */
  get visibleOutputTokens() {
    return Math.max(0, (this.outputTokens ?? 0) - (this.reasoningTokens ?? 0))
  }

  static from(input: UsageInput) {
    return input instanceof Usage ? input : new Usage(input)
  }
}

export type UsageInput = Usage | ConstructorParameters<typeof Usage>[0]

export const StepStart = Schema.Struct({
  type: Schema.tag("step-start"),
  index: Schema.Number,
}).annotate({ identifier: "LLM.Event.StepStart" })
export type StepStart = Schema.Schema.Type<typeof StepStart>

export const TextStart = Schema.Struct({
  type: Schema.tag("text-start"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextStart" })
export type TextStart = Schema.Schema.Type<typeof TextStart>

export const TextDelta = Schema.Struct({
  type: Schema.tag("text-delta"),
  id: ContentBlockID,
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextDelta" })
export type TextDelta = Schema.Schema.Type<typeof TextDelta>

export const TextEnd = Schema.Struct({
  type: Schema.tag("text-end"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.TextEnd" })
export type TextEnd = Schema.Schema.Type<typeof TextEnd>

export const ReasoningStart = Schema.Struct({
  type: Schema.tag("reasoning-start"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ReasoningStart" })
export type ReasoningStart = Schema.Schema.Type<typeof ReasoningStart>

export const ReasoningDelta = Schema.Struct({
  type: Schema.tag("reasoning-delta"),
  id: ContentBlockID,
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ReasoningDelta" })
export type ReasoningDelta = Schema.Schema.Type<typeof ReasoningDelta>

export const ReasoningEnd = Schema.Struct({
  type: Schema.tag("reasoning-end"),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ReasoningEnd" })
export type ReasoningEnd = Schema.Schema.Type<typeof ReasoningEnd>

export const ToolInputStart = Schema.Struct({
  type: Schema.tag("tool-input-start"),
  id: ToolCallID,
  name: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolInputStart" })
export type ToolInputStart = Schema.Schema.Type<typeof ToolInputStart>

export const ToolInputDelta = Schema.Struct({
  type: Schema.tag("tool-input-delta"),
  id: ToolCallID,
  name: Schema.String,
  text: Schema.String,
}).annotate({ identifier: "LLM.Event.ToolInputDelta" })
export type ToolInputDelta = Schema.Schema.Type<typeof ToolInputDelta>

export const ToolInputEnd = Schema.Struct({
  type: Schema.tag("tool-input-end"),
  id: ToolCallID,
  name: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolInputEnd" })
export type ToolInputEnd = Schema.Schema.Type<typeof ToolInputEnd>

export const ToolCall = Schema.Struct({
  type: Schema.tag("tool-call"),
  id: ToolCallID,
  name: Schema.String,
  input: Schema.Unknown,
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolCall" })
export type ToolCall = Schema.Schema.Type<typeof ToolCall>

export const ToolResult = Schema.Struct({
  type: Schema.tag("tool-result"),
  id: ToolCallID,
  name: Schema.String,
  result: ToolResultValue,
  output: Schema.optional(ToolOutput),
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolResult" })
export type ToolResult = Schema.Schema.Type<typeof ToolResult>

export const ToolError = Schema.Struct({
  type: Schema.tag("tool-error"),
  id: ToolCallID,
  name: Schema.String,
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ToolError" })
export type ToolError = Schema.Schema.Type<typeof ToolError>

export const StepFinish = Schema.Struct({
  type: Schema.tag("step-finish"),
  index: Schema.Number,
  reason: FinishReason,
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.StepFinish" })
export type StepFinish = Schema.Schema.Type<typeof StepFinish>

export const Finish = Schema.Struct({
  type: Schema.tag("finish"),
  reason: FinishReason,
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.Finish" })
export type Finish = Schema.Schema.Type<typeof Finish>

export const ProviderErrorEvent = Schema.Struct({
  type: Schema.tag("provider-error"),
  message: Schema.String,
  classification: Schema.optional(ProviderFailureClassification),
  retryable: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Event.ProviderError" })
export type ProviderErrorEvent = Schema.Schema.Type<typeof ProviderErrorEvent>

const llmEventTagged = Schema.Union([
  StepStart,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolCall,
  ToolResult,
  ToolError,
  StepFinish,
  Finish,
  ProviderErrorEvent,
]).pipe(Schema.toTaggedUnion("type"))

type WithID<Event extends { readonly id: unknown }, ID> = Omit<Event, "type" | "id"> & { readonly id: ID | string }
type WithUsage<Event extends { readonly usage?: Usage }> = Omit<Event, "type" | "usage"> & {
  readonly usage?: UsageInput
}

const contentBlockID = (value: ContentBlockID | string) => ContentBlockID.make(value)
const toolCallID = (value: ToolCallID | string) => ToolCallID.make(value)

/**
 * camelCase aliases for `LLMEvent.guards` (provided by `Schema.toTaggedUnion`).
 * Lets consumers write `events.filter(LLMEvent.is.toolCall)` instead of
 * `events.filter(LLMEvent.guards["tool-call"])`.
 */
export const LLMEvent = Object.assign(llmEventTagged, {
  stepStart: StepStart.make,
  textStart: (input: WithID<TextStart, ContentBlockID>) => TextStart.make({ ...input, id: contentBlockID(input.id) }),
  textDelta: (input: WithID<TextDelta, ContentBlockID>) => TextDelta.make({ ...input, id: contentBlockID(input.id) }),
  textEnd: (input: WithID<TextEnd, ContentBlockID>) => TextEnd.make({ ...input, id: contentBlockID(input.id) }),
  reasoningStart: (input: WithID<ReasoningStart, ContentBlockID>) =>
    ReasoningStart.make({ ...input, id: contentBlockID(input.id) }),
  reasoningDelta: (input: WithID<ReasoningDelta, ContentBlockID>) =>
    ReasoningDelta.make({ ...input, id: contentBlockID(input.id) }),
  reasoningEnd: (input: WithID<ReasoningEnd, ContentBlockID>) =>
    ReasoningEnd.make({ ...input, id: contentBlockID(input.id) }),
  toolInputStart: (input: WithID<ToolInputStart, ToolCallID>) =>
    ToolInputStart.make({ ...input, id: toolCallID(input.id) }),
  toolInputDelta: (input: WithID<ToolInputDelta, ToolCallID>) =>
    ToolInputDelta.make({ ...input, id: toolCallID(input.id) }),
  toolInputEnd: (input: WithID<ToolInputEnd, ToolCallID>) => ToolInputEnd.make({ ...input, id: toolCallID(input.id) }),
  toolCall: (input: WithID<ToolCall, ToolCallID>) => ToolCall.make({ ...input, id: toolCallID(input.id) }),
  toolResult: (input: WithID<ToolResult, ToolCallID>) =>
    ToolResult.make({
      ...input,
      id: toolCallID(input.id),
      output: input.output === undefined ? undefined : ToolOutput.make(input.output.structured, input.output.content),
    }),
  toolError: (input: WithID<ToolError, ToolCallID>) => ToolError.make({ ...input, id: toolCallID(input.id) }),
  stepFinish: (input: WithUsage<StepFinish>) =>
    StepFinish.make({
      ...input,
      usage: input.usage === undefined ? undefined : Usage.from(input.usage),
    }),
  finish: (input: WithUsage<Finish>) =>
    Finish.make({
      ...input,
      usage: input.usage === undefined ? undefined : Usage.from(input.usage),
    }),
  providerError: ProviderErrorEvent.make,
  is: {
    stepStart: llmEventTagged.guards["step-start"],
    textStart: llmEventTagged.guards["text-start"],
    textDelta: llmEventTagged.guards["text-delta"],
    textEnd: llmEventTagged.guards["text-end"],
    reasoningStart: llmEventTagged.guards["reasoning-start"],
    reasoningDelta: llmEventTagged.guards["reasoning-delta"],
    reasoningEnd: llmEventTagged.guards["reasoning-end"],
    toolInputStart: llmEventTagged.guards["tool-input-start"],
    toolInputDelta: llmEventTagged.guards["tool-input-delta"],
    toolInputEnd: llmEventTagged.guards["tool-input-end"],
    toolCall: llmEventTagged.guards["tool-call"],
    toolResult: llmEventTagged.guards["tool-result"],
    toolError: llmEventTagged.guards["tool-error"],
    stepFinish: llmEventTagged.guards["step-finish"],
    finish: llmEventTagged.guards.finish,
    providerError: llmEventTagged.guards["provider-error"],
  },
})
export type LLMEvent = Schema.Schema.Type<typeof llmEventTagged>

export class PreparedRequest extends Schema.Class<PreparedRequest>("LLM.PreparedRequest")({
  id: Schema.String,
  route: RouteID,
  protocol: ProtocolID,
  model: ModelSchema,
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

interface ContentAssembly {
  readonly contentIndex: number
  readonly text: string
  readonly providerMetadata?: ProviderMetadata
}

interface ToolInputAssembly {
  readonly name: string
  readonly text: string
  readonly providerMetadata?: ProviderMetadata
}

interface ResponseState {
  readonly events: ReadonlyArray<LLMEvent>
  readonly message: Message
  readonly usage?: Usage
  readonly finishReason?: FinishReason
  readonly textParts: Readonly<Record<string, ContentAssembly>>
  readonly reasoningParts: Readonly<Record<string, ContentAssembly>>
  readonly toolInputs: Readonly<Record<string, ToolInputAssembly>>
}

const emptyResponseState = (): ResponseState => ({
  events: [],
  message: Message.assistant([]),
  textParts: {},
  reasoningParts: {},
  toolInputs: {},
})

const appendEvent = (state: ResponseState, event: LLMEvent): ResponseState => {
  const events = [...state.events, event]
  if (LLMEvent.is.finish(event)) {
    return {
      ...state,
      events,
      usage: event.usage ?? state.usage,
      finishReason: event.reason,
    }
  }
  if (LLMEvent.is.providerError(event)) {
    return {
      ...state,
      events,
      finishReason: state.finishReason ?? "error",
    }
  }
  return {
    ...state,
    events,
    usage: "usage" in event && event.usage !== undefined ? event.usage : state.usage,
  }
}

const textContent = (text: string, providerMetadata: ProviderMetadata | undefined): ContentPart =>
  providerMetadata === undefined ? { type: "text", text } : { type: "text", text, providerMetadata }

const reasoningContent = (text: string, providerMetadata: ProviderMetadata | undefined): ContentPart =>
  providerMetadata === undefined ? { type: "reasoning", text } : { type: "reasoning", text, providerMetadata }

const contentWith = (state: ResponseState, content: ReadonlyArray<ContentPart>): ResponseState => ({
  ...state,
  message: Message.assistant(content),
})

const appendContent = (state: ResponseState, part: ContentPart) => contentWith(state, [...state.message.content, part])

const replaceContent = (state: ResponseState, index: number, part: ContentPart) =>
  contentWith(
    state,
    state.message.content.map((item, itemIndex) => (itemIndex === index ? part : item)),
  )

const ensureText = (state: ResponseState, id: string, providerMetadata?: ProviderMetadata): ResponseState => {
  if (state.textParts[id]) return state
  return {
    ...appendContent(state, textContent("", providerMetadata)),
    textParts: {
      ...state.textParts,
      [id]: { contentIndex: state.message.content.length, text: "", providerMetadata },
    },
  }
}

const reduceTextDelta = (state: ResponseState, event: TextDelta): ResponseState => {
  const started = ensureText(state, event.id, event.providerMetadata)
  const current = started.textParts[event.id]
  if (!current) return started
  const text = current.text + event.text
  const providerMetadata = event.providerMetadata ?? current.providerMetadata
  return {
    ...replaceContent(started, current.contentIndex, textContent(text, providerMetadata)),
    textParts: { ...started.textParts, [event.id]: { ...current, text, providerMetadata } },
  }
}

const reduceTextEnd = (state: ResponseState, event: TextEnd): ResponseState => {
  const current = state.textParts[event.id]
  if (!current) return state
  const providerMetadata = event.providerMetadata ?? current.providerMetadata
  return {
    ...replaceContent(state, current.contentIndex, textContent(current.text, providerMetadata)),
    textParts: { ...state.textParts, [event.id]: { ...current, providerMetadata } },
  }
}

const ensureReasoning = (state: ResponseState, id: string, providerMetadata?: ProviderMetadata): ResponseState => {
  if (state.reasoningParts[id]) return state
  return {
    ...appendContent(state, reasoningContent("", providerMetadata)),
    reasoningParts: {
      ...state.reasoningParts,
      [id]: { contentIndex: state.message.content.length, text: "", providerMetadata },
    },
  }
}

const reduceReasoningDelta = (state: ResponseState, event: ReasoningDelta): ResponseState => {
  const started = ensureReasoning(state, event.id, event.providerMetadata)
  const current = started.reasoningParts[event.id]
  if (!current) return started
  const text = current.text + event.text
  const providerMetadata = event.providerMetadata ?? current.providerMetadata
  return {
    ...replaceContent(started, current.contentIndex, reasoningContent(text, providerMetadata)),
    reasoningParts: { ...started.reasoningParts, [event.id]: { ...current, text, providerMetadata } },
  }
}

const reduceReasoningEnd = (state: ResponseState, event: ReasoningEnd): ResponseState => {
  const current = state.reasoningParts[event.id]
  if (!current) return state
  const providerMetadata = event.providerMetadata ?? current.providerMetadata
  return {
    ...replaceContent(state, current.contentIndex, reasoningContent(current.text, providerMetadata)),
    reasoningParts: { ...state.reasoningParts, [event.id]: { ...current, providerMetadata } },
  }
}

const reduceToolInputStart = (state: ResponseState, event: ToolInputStart): ResponseState => ({
  ...state,
  toolInputs: {
    ...state.toolInputs,
    [event.id]: { name: event.name, text: "", providerMetadata: event.providerMetadata },
  },
})

const reduceToolInputDelta = (state: ResponseState, event: ToolInputDelta): ResponseState => {
  const current = state.toolInputs[event.id] ?? { name: event.name, text: "" }
  return {
    ...state,
    toolInputs: { ...state.toolInputs, [event.id]: { ...current, text: current.text + event.text } },
  }
}

const reduceToolInputEnd = (state: ResponseState, event: ToolInputEnd): ResponseState => {
  const current = state.toolInputs[event.id] ?? { name: event.name, text: "" }
  return {
    ...state,
    toolInputs: {
      ...state.toolInputs,
      [event.id]: {
        ...current,
        name: event.name,
        providerMetadata: event.providerMetadata ?? current.providerMetadata,
      },
    },
  }
}

const toolCallContent = (event: ToolCall): ContentPart =>
  ToolCallPart.make({
    id: event.id,
    name: event.name,
    input: event.input,
    ...(event.providerExecuted === undefined ? {} : { providerExecuted: event.providerExecuted }),
    ...(event.providerMetadata === undefined ? {} : { providerMetadata: event.providerMetadata }),
  })

const toolResultContent = (event: ToolResult): ContentPart =>
  ToolResultPart.make({
    id: event.id,
    name: event.name,
    result: event.result,
    ...(event.providerExecuted === undefined ? {} : { providerExecuted: event.providerExecuted }),
    ...(event.providerMetadata === undefined ? {} : { providerMetadata: event.providerMetadata }),
  })

const reduceToolCall = (state: ResponseState, event: ToolCall): ResponseState => {
  const { [event.id]: _finished, ...toolInputs } = state.toolInputs
  return { ...appendContent(state, toolCallContent(event)), toolInputs }
}

const reduceResponseState = (state: ResponseState, event: LLMEvent): ResponseState => {
  const next = appendEvent(state, event)
  switch (event.type) {
    case "text-start":
      return ensureText(next, event.id, event.providerMetadata)
    case "text-delta":
      return reduceTextDelta(next, event)
    case "text-end":
      return reduceTextEnd(next, event)
    case "reasoning-start":
      return ensureReasoning(next, event.id, event.providerMetadata)
    case "reasoning-delta":
      return reduceReasoningDelta(next, event)
    case "reasoning-end":
      return reduceReasoningEnd(next, event)
    case "tool-input-start":
      return reduceToolInputStart(next, event)
    case "tool-input-delta":
      return reduceToolInputDelta(next, event)
    case "tool-input-end":
      return reduceToolInputEnd(next, event)
    case "tool-call":
      return reduceToolCall(next, event)
    case "tool-result":
      return appendContent(next, toolResultContent(event))
    default:
      return next
  }
}

export class LLMResponse extends Schema.Class<LLMResponse>("LLM.Response")({
  message: Message,
  events: Schema.Array(LLMEvent),
  usage: Schema.optional(Usage),
  finishReason: FinishReason,
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
  export type State = ResponseState
  export type Output = LLMResponse | { readonly events: ReadonlyArray<LLMEvent>; readonly usage?: Usage }

  /** Initial reducer state for assembling one provider attempt. */
  export const empty = emptyResponseState

  /** Purely fold one provider-neutral event into the attempt assembly state. */
  export const reduce = reduceResponseState

  /** Return a completed response only after a terminal finish or provider error. */
  export const complete = (state: State): LLMResponse | undefined =>
    state.finishReason === undefined
      ? undefined
      : new LLMResponse({
          message: state.message,
          events: [...state.events],
          usage: state.usage,
          finishReason: state.finishReason,
        })

  /** Convenience reducer for callers that already have a collected event list. */
  export const fromEvents = (events: ReadonlyArray<LLMEvent>) => complete(events.reduce(reduce, empty()))

  /** Concatenate assistant text from a response or collected event list. */
  export const text = (response: Output) => responseText(response.events)

  /** Return response usage, falling back to the latest usage-bearing event. */
  export const usage = (response: Output) => response.usage ?? responseUsage(response.events)

  /** Return completed tool calls from a response or collected event list. */
  export const toolCalls = (response: Output) => response.events.filter(LLMEvent.is.toolCall)

  /** Concatenate reasoning text from a response or collected event list. */
  export const reasoning = (response: Output) => responseReasoning(response.events)
}
