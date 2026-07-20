import { Effect, Schema } from "effect"
import { Route } from "../route/client"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { HttpTransport } from "../route/transport"
import { Protocol } from "../route/protocol"
import {
  LLMEvent,
  Usage,
  type FinishReason,
  type JsonSchema,
  type LLMRequest,
  type MediaPart,
  type ReasoningPart,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolContent,
} from "../schema"
import { isRecord, JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared"
import { OpenAIOptions } from "./utils/openai-options"
import { Lifecycle } from "./utils/lifecycle"
import { ToolSchemaProjection } from "./utils/tool-schema"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "openai-chat"
const IMAGE_MIMES = new Set<string>(ProviderShared.IMAGE_MIMES)
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/chat/completions"

// =============================================================================
// Request Body Schema
// =============================================================================
// The body schema is the provider-native JSON body. `fromRequest` below builds
// this shape from the common `LLMRequest`, then `Route.make` validates and
// JSON-encodes it before transport.
const OpenAIChatFunction = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
})

const OpenAIChatTool = Schema.Struct({
  type: Schema.tag("function"),
  function: OpenAIChatFunction,
})
type OpenAIChatTool = Schema.Schema.Type<typeof OpenAIChatTool>

const OpenAIChatAssistantToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.tag("function"),
  function: Schema.Struct({
    name: Schema.String,
    arguments: Schema.String,
  }),
})
type OpenAIChatAssistantToolCall = Schema.Schema.Type<typeof OpenAIChatAssistantToolCall>

const OpenAIChatUserContent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("image_url"),
    image_url: Schema.Struct({ url: Schema.String }),
  }),
])

const OpenAIChatMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({
    role: Schema.Literal("user"),
    content: Schema.Union([Schema.String, Schema.Array(OpenAIChatUserContent)]),
  }),
  Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.NullOr(Schema.String),
    tool_calls: optionalArray(OpenAIChatAssistantToolCall),
    reasoning_content: Schema.optional(Schema.String),
    reasoning: Schema.optional(Schema.String),
    reasoning_text: Schema.optional(Schema.String),
    reasoning_details: optionalArray(Schema.Unknown),
  }),
  Schema.Struct({ role: Schema.Literal("tool"), tool_call_id: Schema.String, content: Schema.String }),
]).pipe(Schema.toTaggedUnion("role"))
type OpenAIChatMessage = Schema.Schema.Type<typeof OpenAIChatMessage>

const OpenAIChatToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({
    type: Schema.tag("function"),
    function: Schema.Struct({ name: Schema.String }),
  }),
])

export const bodyFields = {
  model: Schema.String,
  messages: Schema.Array(OpenAIChatMessage),
  tools: optionalArray(OpenAIChatTool),
  tool_choice: Schema.optional(OpenAIChatToolChoice),
  stream: Schema.Literal(true),
  stream_options: Schema.optional(Schema.Struct({ include_usage: Schema.Boolean })),
  store: Schema.optional(Schema.Boolean),
  reasoning_effort: Schema.optional(OpenAIOptions.OpenAIReasoningEffort),
  max_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  frequency_penalty: Schema.optional(Schema.Number),
  presence_penalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stop: optionalArray(Schema.String),
}
const OpenAIChatBody = Schema.Struct(bodyFields)
export type OpenAIChatBody = Schema.Schema.Type<typeof OpenAIChatBody>

// =============================================================================
// Streaming Event Schema
// =============================================================================
// The event schema is one decoded SSE `data:` payload. `Framing.sse` splits the
// byte stream into strings, then `Protocol.jsonEvent` decodes each string into
// this provider-native event shape.
const OpenAIChatUsage = Schema.Struct({
  prompt_tokens: Schema.optional(Schema.Number),
  completion_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
  prompt_tokens_details: optionalNull(
    Schema.Struct({
      cached_tokens: Schema.optional(Schema.Number),
    }),
  ),
  completion_tokens_details: optionalNull(
    Schema.Struct({
      reasoning_tokens: Schema.optional(Schema.Number),
    }),
  ),
})

const OpenAIChatToolCallDeltaFunction = Schema.Struct({
  name: optionalNull(Schema.String),
  arguments: optionalNull(Schema.String),
})

const OpenAIChatToolCallDelta = Schema.Struct({
  index: Schema.Number,
  id: optionalNull(Schema.String),
  function: optionalNull(OpenAIChatToolCallDeltaFunction),
})
type OpenAIChatToolCallDelta = Schema.Schema.Type<typeof OpenAIChatToolCallDelta>

const OpenAIChatDelta = Schema.Struct({
  content: optionalNull(Schema.String),
  reasoning_content: optionalNull(Schema.String),
  reasoning: optionalNull(Schema.String),
  reasoning_text: optionalNull(Schema.String),
  reasoning_details: optionalNull(Schema.Array(Schema.Unknown)),
  tool_calls: optionalNull(Schema.Array(OpenAIChatToolCallDelta)),
})

const OpenAIChatChoice = Schema.Struct({
  delta: optionalNull(OpenAIChatDelta),
  finish_reason: optionalNull(Schema.String),
})

export const OpenAIChatEvent = Schema.Struct({
  choices: Schema.Array(OpenAIChatChoice),
  usage: optionalNull(OpenAIChatUsage),
})
export type OpenAIChatEvent = Schema.Schema.Type<typeof OpenAIChatEvent>
type OpenAIChatRequestMessage = LLMRequest["messages"][number]

interface PendingToolDelta {
  readonly id?: string
  readonly name?: string
  readonly input: string
}

export interface ParserState {
  readonly tools: ToolStream.State<number>
  readonly pendingTools: Partial<Record<number, PendingToolDelta>>
  readonly toolCallEvents: ReadonlyArray<LLMEvent>
  readonly usage?: Usage
  readonly finishReason?: FinishReason
  readonly lifecycle: Lifecycle.State
  readonly reasoningField?: "reasoning" | "reasoning_content" | "reasoning_text"
  readonly reasoningDetails: Array<unknown>
  readonly reasoningDetailsObserved: boolean
  readonly reasoningEmitted: boolean
}

// =============================================================================
// Request Lowering
// =============================================================================
// Lowering is the only place that knows how common LLM messages map onto the
// OpenAI Chat wire format. Keep provider quirks here instead of leaking native
// fields into `LLMRequest`.
const lowerTool = (tool: ToolDefinition, inputSchema: JsonSchema): OpenAIChatTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: ToolSchemaProjection.openAI(inputSchema),
  },
})

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice("OpenAI Chat", toolChoice, {
    auto: () => "auto" as const,
    none: () => "none" as const,
    required: () => "required" as const,
    tool: (name) => ({ type: "function" as const, function: { name } }),
  })

const lowerToolCall = (part: ToolCallPart): OpenAIChatAssistantToolCall => ({
  id: part.id,
  type: "function",
  function: {
    name: part.name,
    arguments: ProviderShared.encodeJson(part.input),
  },
})

const lowerMedia = Effect.fn("OpenAIChat.lowerMedia")(function* (part: MediaPart) {
  const media = yield* ProviderShared.validateMedia("OpenAI Chat", part, IMAGE_MIMES)
  return { type: "image_url" as const, image_url: { url: media.dataUrl } }
})

const openAICompatibleReasoningContent = (native: unknown) =>
  isRecord(native) && typeof native.reasoning_content === "string" ? native.reasoning_content : undefined

const reasoningField = (part: ReasoningPart) => {
  const field = part.providerMetadata?.openai?.reasoningField
  if (field === "reasoning" || field === "reasoning_content" || field === "reasoning_text") return field
}

const reasoningDetails = (parts: ReadonlyArray<ReasoningPart>, native: unknown) => {
  const observed = parts.flatMap((part) => {
    const details = part.providerMetadata?.openai?.reasoningDetails
    return Array.isArray(details) ? details : []
  })
  if (parts.some((part) => Array.isArray(part.providerMetadata?.openai?.reasoningDetails))) return observed
  if (isRecord(native) && Array.isArray(native.reasoning_details)) return native.reasoning_details
}

const lowerUserMessage = Effect.fn("OpenAIChat.lowerUserMessage")(function* (message: OpenAIChatRequestMessage) {
  const content: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = []
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text })
      continue
    }
    if (part.type === "media") {
      content.push(yield* lowerMedia(part))
      continue
    }
    return yield* ProviderShared.unsupportedContent("OpenAI Chat", "user", ["text", "media"])
  }
  if (content.every((part) => part.type === "text"))
    return { role: "user" as const, content: content.map((part) => part.text).join("") }
  return { role: "user" as const, content }
})

const lowerAssistantMessage = Effect.fn("OpenAIChat.lowerAssistantMessage")(function* (
  message: OpenAIChatRequestMessage,
) {
  const content: TextPart[] = []
  const reasoning: ReasoningPart[] = []
  const toolCalls: OpenAIChatAssistantToolCall[] = []
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ["text", "reasoning", "tool-call"]))
      return yield* ProviderShared.unsupportedContent("OpenAI Chat", "assistant", ["text", "reasoning", "tool-call"])
    if (part.type === "text") {
      content.push(part)
      continue
    }
    if (part.type === "reasoning") {
      reasoning.push(part)
      continue
    }
    if (part.type === "tool-call") {
      toolCalls.push(lowerToolCall(part))
      continue
    }
  }
  const text = reasoning.map((part) => part.text).join("")
  const details = reasoningDetails(reasoning, message.native?.openaiCompatible)
  const observedField = reasoning.map(reasoningField).find((value) => value !== undefined)
  const nativeReasoning = openAICompatibleReasoningContent(message.native?.openaiCompatible)
  const fullyStructured = reasoning.every((part) => Array.isArray(part.providerMetadata?.openai?.reasoningDetails))
  const field = (() => {
    if (reasoning.length === 0) return
    if (observedField !== undefined) return observedField
    if (nativeReasoning !== undefined) return "reasoning_content"
    if (!fullyStructured) return "reasoning_content"
  })()
  const reasoningContent = (() => {
    if (reasoning.length === 0) return nativeReasoning
    if (field === "reasoning_content") return text
  })()
  return {
    role: "assistant" as const,
    content: content.length === 0 ? null : ProviderShared.joinText(content),
    tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
    reasoning_content: reasoningContent,
    reasoning: reasoning.length > 0 && field === "reasoning" ? text : undefined,
    reasoning_text: reasoning.length > 0 && field === "reasoning_text" ? text : undefined,
    reasoning_details: details,
  }
})

const lowerToolMessages = Effect.fn("OpenAIChat.lowerToolMessages")(function* (message: OpenAIChatRequestMessage) {
  const messages: OpenAIChatMessage[] = []
  const images: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = []
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ["tool-result"]))
      return yield* ProviderShared.unsupportedContent("OpenAI Chat", "tool", ["tool-result"])
    if (part.result.type !== "content") {
      messages.push({ role: "tool", tool_call_id: part.id, content: ProviderShared.toolResultText(part) })
      continue
    }
    const content: ReadonlyArray<ToolContent> = part.result.value
    const text = content.filter((item) => item.type === "text").map((item) => item.text)
    messages.push({ role: "tool", tool_call_id: part.id, content: text.join("\n") })
    const files = content.filter((item) => item.type === "file")
    images.push(
      ...(yield* Effect.forEach(files, (item) =>
        lowerMedia({ type: "media", mediaType: item.mime, data: item.uri, filename: item.name }),
      )),
    )
  }
  return { messages, images }
})

const lowerMessage = Effect.fn("OpenAIChat.lowerMessage")(function* (message: OpenAIChatRequestMessage) {
  if (message.role === "user") return [yield* lowerUserMessage(message)]
  if (message.role === "assistant") return [yield* lowerAssistantMessage(message)]
  return (yield* lowerToolMessages(message)).messages
})

const lowerMessages = Effect.fn("OpenAIChat.lowerMessages")(function* (request: LLMRequest) {
  const system: OpenAIChatMessage[] =
    request.system.length === 0 ? [] : [{ role: "system", content: ProviderShared.joinText(request.system) }]
  const messages = [...system]
  const pendingImages: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = []
  const flushImages = () => {
    if (pendingImages.length === 0) return
    messages.push({ role: "user", content: pendingImages.splice(0) })
  }
  for (const message of request.messages) {
    if (message.role === "system") {
      const part = yield* ProviderShared.wrappedSystemUpdate("OpenAI Chat", message)
      if (pendingImages.length > 0) {
        messages.push({ role: "user", content: [...pendingImages.splice(0), { type: "text", text: part.text }] })
        continue
      }
      const previous = messages.at(-1)
      if (previous?.role === "user" && typeof previous.content === "string")
        messages[messages.length - 1] = { role: "user", content: `${previous.content}\n${part.text}` }
      else if (previous?.role === "user" && Array.isArray(previous.content))
        messages[messages.length - 1] = {
          role: "user",
          content: [...previous.content, { type: "text", text: part.text }],
        }
      else messages.push({ role: "user", content: part.text })
      continue
    }
    if (message.role === "tool") {
      const lowered = yield* lowerToolMessages(message)
      messages.push(...lowered.messages)
      pendingImages.push(...lowered.images)
      continue
    }
    flushImages()
    messages.push(...(yield* lowerMessage(message)))
  }
  flushImages()
  return messages
})

const lowerOptions = Effect.fn("OpenAIChat.lowerOptions")(function* (request: LLMRequest) {
  const store = OpenAIOptions.store(request)
  const reasoningEffort = OpenAIOptions.reasoningEffort(request)
  return {
    ...(store !== undefined ? { store } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  }
})

const fromRequest = Effect.fn("OpenAIChat.fromRequest")(function* (request: LLMRequest) {
  // `fromRequest` returns the provider body only. Endpoint, auth, framing,
  // validation, and HTTP execution are composed by `Route.make`.
  const generation = request.generation
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema
  return {
    model: request.model.id,
    messages: yield* lowerMessages(request),
    tools:
      request.tools.length === 0
        ? undefined
        : request.tools.map((tool) =>
            lowerTool(tool, ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility)),
          ),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    stream_options: { include_usage: true },
    max_tokens: generation?.maxTokens,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    frequency_penalty: generation?.frequencyPenalty,
    presence_penalty: generation?.presencePenalty,
    seed: generation?.seed,
    stop: generation?.stop,
    ...(yield* lowerOptions(request)),
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
// Streaming parsers are small state machines: every event returns a new state
// plus the common `LLMEvent`s produced by that event. Tool calls are accumulated
// because OpenAI streams JSON arguments across multiple deltas.
const mapFinishReason = (reason: string | null | undefined): FinishReason => {
  if (reason === "stop") return "stop"
  if (reason === "length") return "length"
  if (reason === "content_filter") return "content-filter"
  if (reason === "function_call" || reason === "tool_calls") return "tool-calls"
  return "unknown"
}

// OpenAI Chat reports `prompt_tokens` (inclusive total) with a
// `cached_tokens` subset, and `completion_tokens` (inclusive total) with
// a `reasoning_tokens` subset. We pass the inclusive totals through and
// derive the non-cached breakdown so the `LLM.Usage` contract is
// satisfied on both sides.
const mapUsage = (usage: OpenAIChatEvent["usage"]): Usage | undefined => {
  if (!usage) return undefined
  const cached = usage.prompt_tokens_details?.cached_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const nonCached = ProviderShared.subtractTokens(usage.prompt_tokens, cached)
  return new Usage({
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    reasoningTokens: reasoning,
    totalTokens: ProviderShared.totalTokens(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens),
    providerMetadata: { openai: usage },
  })
}

const reasoningDelta = (delta: Schema.Schema.Type<typeof OpenAIChatDelta> | null | undefined) => {
  if (delta?.reasoning_content) return { field: "reasoning_content", text: delta.reasoning_content } as const
  if (delta?.reasoning) return { field: "reasoning", text: delta.reasoning } as const
  if (delta?.reasoning_text) return { field: "reasoning_text", text: delta.reasoning_text } as const
}

const detailText = (details: ReadonlyArray<unknown>) => {
  const text = details.flatMap((detail) => {
    if (!isRecord(detail)) return []
    if (detail.type === "reasoning.text" && typeof detail.text === "string" && detail.text) return [detail.text]
    if (detail.type === "reasoning.summary" && typeof detail.summary === "string" && detail.summary)
      return [detail.summary]
    return []
  })
  if (text.length > 0) return text.join("")
}

const appendReasoningDetails = (result: Array<unknown>, details: ReadonlyArray<unknown>) => {
  for (const detail of details) {
    const previous = result.at(-1)
    if (
      !isRecord(previous) ||
      previous.type !== "reasoning.text" ||
      !isRecord(detail) ||
      detail.type !== "reasoning.text" ||
      conflictingReasoningTextDetails(previous, detail)
    ) {
      result.push(detail)
      continue
    }
    result[result.length - 1] = {
      ...previous,
      ...Object.fromEntries(Object.entries(detail).filter((entry) => entry[1] !== undefined)),
      text: `${typeof previous.text === "string" ? previous.text : ""}${typeof detail.text === "string" ? detail.text : ""}`,
      signature: mergeDetailValue(previous.signature, detail.signature),
      format: mergeDetailValue(previous.format, detail.format),
    }
  }
}

const mergeDetailValue = (previous: unknown, current: unknown) =>
  previous || current || (previous !== undefined ? previous : current)

const conflictingReasoningTextDetails = (previous: Record<string, unknown>, current: Record<string, unknown>) =>
  conflictingDetailValue(previous.id, current.id) ||
  conflictingDetailValue(previous.index, current.index) ||
  conflictingDetailValue(previous.format, current.format) ||
  (Boolean(previous.signature) && Boolean(current.signature) && previous.signature !== current.signature)

const conflictingDetailValue = (previous: unknown, current: unknown) =>
  previous !== undefined && previous !== null && current !== undefined && current !== null && previous !== current

const reasoningMetadata = (field: ParserState["reasoningField"], details?: ReadonlyArray<unknown>) => ({
  openai: {
    ...(field ? { reasoningField: field } : {}),
    ...(details ? { reasoningDetails: details } : {}),
  },
})

const step = (state: ParserState, event: OpenAIChatEvent) =>
  Effect.gen(function* () {
    const events: LLMEvent[] = []
    const usage = mapUsage(event.usage) ?? state.usage
    const choice = event.choices[0]
    const finishReason = choice?.finish_reason ? mapFinishReason(choice.finish_reason) : state.finishReason
    const delta = choice?.delta
    const toolDeltas = delta?.tool_calls ?? []
    let tools = state.tools
    let pendingTools = state.pendingTools

    let lifecycle = state.lifecycle

    const reasoning = reasoningDelta(delta)
    const reasoningField = state.reasoningField ?? (!state.lifecycle.text.has("text-0") ? reasoning?.field : undefined)
    const detailDelta = Array.isArray(delta?.reasoning_details) ? delta.reasoning_details : undefined
    if (detailDelta !== undefined) appendReasoningDetails(state.reasoningDetails, detailDelta)
    const reasoningDetailsObserved = state.reasoningDetailsObserved || detailDelta !== undefined
    const deltaMetadata = reasoningMetadata(reasoningField)
    const text = detailDelta?.length ? (detailText(detailDelta) ?? reasoning?.text) : reasoning?.text
    if (!state.lifecycle.text.has("text-0") && text !== undefined)
      lifecycle = Lifecycle.reasoningDelta(lifecycle, events, "reasoning-0", text, deltaMetadata)
    else if (
      reasoningDetailsObserved &&
      !lifecycle.reasoning.has("reasoning-0") &&
      (Boolean(delta?.content) || toolDeltas.length > 0)
    )
      lifecycle = Lifecycle.reasoningStart(lifecycle, events, "reasoning-0", deltaMetadata)
    const reasoningEmitted = state.reasoningEmitted || lifecycle.reasoning.has("reasoning-0")

    if (delta?.content) {
      lifecycle = Lifecycle.reasoningEnd(
        lifecycle,
        events,
        "reasoning-0",
        reasoningMetadata(reasoningField, reasoningDetailsObserved ? state.reasoningDetails : undefined),
      )
      lifecycle = Lifecycle.textDelta(lifecycle, events, "text-0", delta.content)
    }

    for (const tool of toolDeltas) {
      const current = tools[tool.index]
      const pending = pendingTools[tool.index]
      const id = current?.id ?? pending?.id ?? (tool.id || undefined)
      const name = current?.name ?? pending?.name ?? (tool.function?.name || undefined)
      const text = `${pending?.input ?? ""}${tool.function?.arguments ?? ""}`
      if (!current && (!id || !name)) {
        pendingTools = { ...pendingTools, [tool.index]: { id: id || undefined, name: name || undefined, input: text } }
        continue
      }
      if (pending) {
        pendingTools = { ...pendingTools }
        delete pendingTools[tool.index]
      }
      const result = ToolStream.appendOrStart(
        ADAPTER,
        tools,
        tool.index,
        { id: id || undefined, name: name || undefined, text },
        "OpenAI Chat tool call delta is missing id or name",
      )
      if (ToolStream.isError(result)) return yield* result
      tools = result.tools
      if (result.events.length) lifecycle = Lifecycle.stepStart(lifecycle, events)
      events.push(...result.events)
    }

    if (finishReason !== undefined && state.finishReason === undefined && Object.keys(pendingTools).length > 0)
      return yield* ProviderShared.eventError(ADAPTER, "OpenAI Chat tool call delta is missing id or name")

    // Finalize accumulated tool inputs eagerly when finish_reason arrives so
    // valid calls and malformed local calls settle independently.
    const finished =
      finishReason !== undefined && state.finishReason === undefined && Object.keys(tools).length > 0
        ? yield* ToolStream.finishAll(ADAPTER, tools)
        : undefined

    return [
      {
        tools: finished?.tools ?? tools,
        pendingTools,
        toolCallEvents: finished?.events ?? state.toolCallEvents,
        usage,
        finishReason,
        lifecycle,
        reasoningField,
        reasoningDetails: state.reasoningDetails,
        reasoningDetailsObserved,
        reasoningEmitted,
      },
      events,
    ] as const
  })

const finishEvents = (state: ParserState): ReadonlyArray<LLMEvent> => {
  const events: LLMEvent[] = []
  const hasToolCalls = state.toolCallEvents.length > 0
  const reason = state.finishReason === "stop" && hasToolCalls ? "tool-calls" : state.finishReason
  const metadata = reasoningMetadata(
    state.reasoningField,
    state.reasoningDetailsObserved ? state.reasoningDetails : undefined,
  )
  const started =
    state.reasoningDetailsObserved && !state.reasoningEmitted
      ? Lifecycle.reasoningStart(state.lifecycle, events, "reasoning-0", reasoningMetadata(state.reasoningField))
      : state.lifecycle
  const ended = Lifecycle.reasoningEnd(started, events, "reasoning-0", metadata)
  const lifecycle = state.toolCallEvents.length ? Lifecycle.stepStart(ended, events) : ended
  events.push(...state.toolCallEvents)
  if (reason) Lifecycle.finish(lifecycle, events, { reason, usage: state.usage })
  return events
}

// =============================================================================
// Protocol And OpenAI Route
// =============================================================================
/**
 * The OpenAI Chat protocol — request body construction, body schema, and the
 * streaming-event state machine. Reused by every route that speaks OpenAI Chat
 * over HTTP+SSE: native OpenAI, DeepSeek, TogetherAI, Cerebras, Baseten,
 * Fireworks, DeepInfra, and (once added) Azure OpenAI Chat.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenAIChatBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(OpenAIChatEvent),
    initial: () => ({
      tools: ToolStream.empty<number>(),
      pendingTools: {},
      toolCallEvents: [],
      lifecycle: Lifecycle.initial(),
      reasoningField: undefined,
      reasoningDetails: [],
      reasoningDetailsObserved: false,
      reasoningEmitted: false,
    }),
    step,
    onHalt: finishEvents,
  },
})

export const httpTransport = HttpTransport.sseJson.with<OpenAIChatBody>()

export const route = Route.make({
  id: ADAPTER,
  provider: "openai",
  providerMetadataKey: "openai",
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  transport: httpTransport,
})

export * as OpenAIChat from "./openai-chat"
