import { Effect, Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { Route } from "../route/client"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { HttpTransport } from "../route/transport"
import { Protocol } from "../route/protocol"
import {
  AIError,
  LLMEvent,
  Usage,
  type FinishReason,
  type FinishReasonDetails,
  type CacheHint,
  type JsonSchema,
  type LLMRequest,
  type MediaPart,
  type ReasoningPart,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
} from "../schema"
import { classifyProviderFailure } from "../provider-error"
import { isRecord, JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared"
import { OpenAIOptions } from "./utils/openai-options"
import { Lifecycle } from "./utils/lifecycle"
import { ToolSchemaProjection } from "./utils/tool-schema"
import { ToolStream } from "./utils/tool-stream"

const ADAPTER = "openai-chat"
const IMAGE_MIMES = new Set<string>(ProviderShared.IMAGE_MIMES)
const RESERVED_REASONING_FIELDS = new Set(["role", "content", "tool_calls"])
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/chat/completions"

// =============================================================================
// Request Body Schema
// =============================================================================
// The body schema is the provider-native JSON body. `fromRequest` below builds
// this shape from the common `LLMRequest`, then `Route.make` validates and
// JSON-encodes it before transport.
const OpenAIChatCacheControl = Schema.Struct({
  type: Schema.Literal("ephemeral"),
  ttl: Schema.optional(Schema.String),
})

const OpenAIChatFunction = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
})

const OpenAIChatTool = Schema.Struct({
  type: Schema.tag("function"),
  function: OpenAIChatFunction,
  cache_control: Schema.optional(OpenAIChatCacheControl),
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
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
    cache_control: Schema.optional(OpenAIChatCacheControl),
  }),
  Schema.Struct({
    type: Schema.Literal("image_url"),
    image_url: Schema.Struct({ url: Schema.String }),
  }),
])

const OpenAIChatMessage = Schema.Union([
  Schema.Struct({
    role: Schema.Literal("system"),
    content: Schema.Union([Schema.String, Schema.Array(OpenAIChatUserContent)]),
  }),
  Schema.Struct({
    role: Schema.Literal("user"),
    content: Schema.Union([Schema.String, Schema.Array(OpenAIChatUserContent)]),
  }),
  Schema.StructWithRest(
    Schema.Struct({
      role: Schema.Literal("assistant"),
      content: Schema.NullOr(Schema.String),
      tool_calls: optionalArray(OpenAIChatAssistantToolCall),
      reasoning_content: Schema.optional(Schema.String),
      reasoning: Schema.optional(Schema.String),
      reasoning_text: Schema.optional(Schema.String),
      reasoning_details: Schema.optional(Schema.Unknown),
      cache_control: Schema.optional(OpenAIChatCacheControl),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
  Schema.Struct({
    role: Schema.Literal("tool"),
    tool_call_id: Schema.String,
    content: Schema.String,
    cache_control: Schema.optional(OpenAIChatCacheControl),
  }),
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
  max_completion_tokens: Schema.optional(Schema.Number),
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
  prompt_tokens: optionalNull(Schema.Number),
  completion_tokens: optionalNull(Schema.Number),
  total_tokens: optionalNull(Schema.Number),
  prompt_tokens_details: optionalNull(
    Schema.Struct({
      cached_tokens: optionalNull(Schema.Number),
      cache_write_tokens: optionalNull(Schema.Number),
    }),
  ),
  completion_tokens_details: optionalNull(
    Schema.Struct({
      reasoning_tokens: optionalNull(Schema.Number),
    }),
  ),
})

const OpenAIChatToolCallDeltaFunction = Schema.Struct({
  name: optionalNull(Schema.String),
  arguments: optionalNull(Schema.String),
})

const OpenAIChatToolCallDelta = Schema.Struct({
  index: optionalNull(Schema.Number),
  id: optionalNull(Schema.String),
  function: optionalNull(OpenAIChatToolCallDeltaFunction),
})
type OpenAIChatToolCallDelta = Schema.Schema.Type<typeof OpenAIChatToolCallDelta>

const OpenAIChatDelta = Schema.StructWithRest(
  Schema.Struct({
    content: optionalNull(Schema.String),
    reasoning_content: optionalNull(Schema.String),
    reasoning: optionalNull(Schema.String),
    reasoning_text: optionalNull(Schema.String),
    reasoning_details: optionalNull(Schema.Unknown),
    tool_calls: optionalNull(Schema.Array(OpenAIChatToolCallDelta)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const OpenAIChatChoice = Schema.Struct({
  delta: optionalNull(OpenAIChatDelta),
  finish_reason: optionalNull(Schema.String),
  native_finish_reason: optionalNull(Schema.String),
})

const OpenAIChatError = Schema.Struct({
  code: optionalNull(Schema.Union([Schema.String, Schema.Number])),
  message: Schema.String,
})

export const OpenAIChatEvent = Schema.Struct({
  choices: optionalNull(Schema.Array(OpenAIChatChoice)),
  usage: optionalNull(OpenAIChatUsage),
  error: optionalNull(OpenAIChatError),
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
  readonly finishReason?: FinishReasonDetails
  readonly lifecycle: Lifecycle.State
  readonly reasoningField?: string
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
interface LoweringOptions {
  readonly cacheControl?: (
    cache: CacheHint | undefined,
  ) => Schema.Schema.Type<typeof OpenAIChatCacheControl> | undefined
}

const lowerTool = (tool: ToolDefinition, inputSchema: JsonSchema, options: LoweringOptions): OpenAIChatTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: ToolSchemaProjection.openAI(inputSchema),
  },
  cache_control: options.cacheControl?.(tool.cache),
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
  return typeof field === "string" ? field : undefined
}

const reasoningDetails = (parts: ReadonlyArray<ReasoningPart>, native: unknown) => {
  const observed = parts.flatMap((part) => {
    const details = part.providerMetadata?.openai?.reasoningDetails
    return Array.isArray(details) ? details : []
  })
  if (parts.some((part) => Array.isArray(part.providerMetadata?.openai?.reasoningDetails))) return observed
  if (isRecord(native) && Array.isArray(native.reasoning_details)) return native.reasoning_details
}

const lowerUserMessage = Effect.fn("OpenAIChat.lowerUserMessage")(function* (
  message: OpenAIChatRequestMessage,
  options: LoweringOptions,
) {
  const content: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = []
  for (const part of message.content) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text, cache_control: options.cacheControl?.(part.cache) })
      continue
    }
    if (part.type === "media") {
      content.push(yield* lowerMedia(part))
      continue
    }
    return yield* ProviderShared.unsupportedContent("OpenAI Chat", "user", ["text", "media"])
  }
  if (content.every((part) => part.type === "text" && part.cache_control === undefined))
    return {
      role: "user" as const,
      content: content.map((part) => (part.type === "text" ? part.text : "")).join(""),
    }
  return { role: "user" as const, content }
})

const lowerAssistantMessage = Effect.fn("OpenAIChat.lowerAssistantMessage")(function* (
  message: OpenAIChatRequestMessage,
  configuredField?: string,
  options: LoweringOptions = {},
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
    if (configuredField !== undefined) return configuredField
    if (reasoning.length === 0) return undefined
    if (observedField !== undefined) return observedField
    if (nativeReasoning !== undefined) return "reasoning_content"
    if (!fullyStructured) return "reasoning_content"
  })()
  const reasoningText = (() => {
    if (configuredField !== undefined) return reasoning.length === 0 ? (nativeReasoning ?? "") : text
    if (reasoning.length === 0) return nativeReasoning
    return text
  })()
  const cached = message.content.findLast((part) => "cache" in part && part.cache !== undefined)
  const result = {
    role: "assistant" as const,
    content: content.length === 0 ? null : ProviderShared.joinText(content),
    tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
    reasoning_details: details,
    cache_control: options.cacheControl?.(cached && "cache" in cached ? cached.cache : undefined),
  }
  if (field === undefined || reasoningText === undefined) return result
  return { ...result, [field]: reasoningText }
})

const lowerToolMessages = Effect.fn("OpenAIChat.lowerToolMessages")(function* (
  message: OpenAIChatRequestMessage,
  options: LoweringOptions,
) {
  const messages: OpenAIChatMessage[] = []
  const images: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = []
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ["tool-result"]))
      return yield* ProviderShared.unsupportedContent("OpenAI Chat", "tool", ["tool-result"])
    if (part.result.type !== "content") {
      messages.push({
        role: "tool",
        tool_call_id: part.id,
        content: ProviderShared.toolResultText(part),
        cache_control: options.cacheControl?.(part.cache),
      })
      continue
    }
    const content: ReadonlyArray<Tool.Content> = part.result.value
    const text = content.filter((item) => item.type === "text").map((item) => item.text)
    messages.push({
      role: "tool",
      tool_call_id: part.id,
      content: text.join("\n"),
      cache_control: options.cacheControl?.(part.cache),
    })
    const files = content.filter((item) => item.type === "file")
    images.push(
      ...(yield* Effect.forEach(files, (item) =>
        lowerMedia({ type: "media", mediaType: item.mime, data: item.uri, filename: item.name }),
      )),
    )
  }
  return { messages, images }
})

const lowerMessage = Effect.fn("OpenAIChat.lowerMessage")(function* (
  message: OpenAIChatRequestMessage,
  reasoningField?: string,
  options: LoweringOptions = {},
) {
  if (message.role === "user") return [yield* lowerUserMessage(message, options)]
  if (message.role === "assistant") return [yield* lowerAssistantMessage(message, reasoningField, options)]
  return (yield* lowerToolMessages(message, options)).messages
})

const lowerMessages = Effect.fn("OpenAIChat.lowerMessages")(function* (request: LLMRequest, options: LoweringOptions) {
  const system: OpenAIChatMessage[] =
    request.system.length === 0
      ? []
      : request.system.some((part) => part.cache !== undefined) && options.cacheControl !== undefined
        ? [
            {
              role: "system",
              content: request.system.map((part) => ({
                type: "text",
                text: part.text,
                cache_control: options.cacheControl?.(part.cache),
              })),
            },
          ]
        : [{ role: "system", content: ProviderShared.joinText(request.system) }]
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
        messages.push({
          role: "user",
          content: [
            ...pendingImages.splice(0),
            { type: "text", text: part.text, cache_control: options.cacheControl?.(part.cache) },
          ],
        })
        continue
      }
      const previous = messages.at(-1)
      if (previous?.role === "user" && typeof previous.content === "string")
        messages[messages.length - 1] = options.cacheControl?.(part.cache)
          ? {
              role: "user",
              content: [
                { type: "text", text: previous.content },
                { type: "text", text: part.text, cache_control: options.cacheControl(part.cache) },
              ],
            }
          : { role: "user", content: `${previous.content}\n${part.text}` }
      else if (previous?.role === "user" && Array.isArray(previous.content))
        messages[messages.length - 1] = {
          role: "user",
          content: [
            ...previous.content,
            { type: "text", text: part.text, cache_control: options.cacheControl?.(part.cache) },
          ],
        }
      else
        messages.push(
          options.cacheControl?.(part.cache)
            ? {
                role: "user",
                content: [{ type: "text", text: part.text, cache_control: options.cacheControl(part.cache) }],
              }
            : { role: "user", content: part.text },
        )
      continue
    }
    if (message.role === "tool") {
      const lowered = yield* lowerToolMessages(message, options)
      messages.push(...lowered.messages)
      pendingImages.push(...lowered.images)
      continue
    }
    flushImages()
    messages.push(...(yield* lowerMessage(message, request.model.compatibility?.reasoningField, options)))
  }
  flushImages()
  return messages
})

const lowerOptions = (request: LLMRequest) => {
  const options = OpenAIOptions.resolve(request)
  return {
    ...(options.store !== undefined ? { store: options.store } : {}),
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
  }
}

export const fromRequest = Effect.fn("OpenAIChat.fromRequest")(function* (
  request: LLMRequest,
  options: LoweringOptions = {},
) {
  // `fromRequest` returns the provider body only. Endpoint, auth, framing,
  // validation, and HTTP execution are composed by `Route.make`.
  const reasoningField = request.model.compatibility?.reasoningField
  if (reasoningField && RESERVED_REASONING_FIELDS.has(reasoningField))
    return yield* ProviderShared.invalidRequest(
      `OpenAI Chat reasoning field conflicts with reserved field ${reasoningField}`,
    )
  const generation = request.generation
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema
  const maxTokensField = request.model.compatibility?.maxTokensField ?? "max_tokens"
  return {
    model: request.model.id,
    messages: yield* lowerMessages(request, options),
    tools:
      request.tools.length === 0
        ? undefined
        : request.tools.map((tool) =>
            lowerTool(
              tool,
              ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility),
              options,
            ),
          ),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    stream_options: { include_usage: true },
    ...(maxTokensField === "max_completion_tokens"
      ? { max_completion_tokens: generation?.maxTokens }
      : { max_tokens: generation?.maxTokens }),
    temperature: generation?.temperature,
    top_p: generation?.topP,
    frequency_penalty: generation?.frequencyPenalty,
    presence_penalty: generation?.presencePenalty,
    seed: generation?.seed,
    stop: generation?.stop,
    ...lowerOptions(request),
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
  if (reason === "error") return "error"
  return "unknown"
}

// OpenAI Chat reports `prompt_tokens` (inclusive total) with a
// cached-read and cache-write subsets, and `completion_tokens` (inclusive
// total) with a `reasoning_tokens` subset. We pass the inclusive totals
// through and derive the non-cached breakdown so the `AI.Usage` contract is
// satisfied on both sides.
const mapUsage = (usage: OpenAIChatEvent["usage"]): Usage | undefined => {
  if (!usage) return undefined
  const input = usage.prompt_tokens ?? undefined
  const output = usage.completion_tokens ?? undefined
  const cached = input === undefined ? undefined : (usage.prompt_tokens_details?.cached_tokens ?? undefined)
  const cacheWrite = input === undefined ? undefined : (usage.prompt_tokens_details?.cache_write_tokens ?? undefined)
  const reasoning = output === undefined ? undefined : (usage.completion_tokens_details?.reasoning_tokens ?? undefined)
  const nonCached = ProviderShared.subtractTokens(input, ProviderShared.sumTokens(cached, cacheWrite))
  return new Usage({
    inputTokens: input,
    outputTokens: output,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    reasoningTokens: reasoning,
    totalTokens: ProviderShared.totalTokens(input, output, usage.total_tokens ?? undefined),
    providerMetadata: { openai: usage },
  })
}

const reasoningDelta = (
  delta: Schema.Schema.Type<typeof OpenAIChatDelta> | null | undefined,
  configuredField?: string,
) => {
  if (!delta) return undefined
  const fields = new Set([configuredField, "reasoning_content", "reasoning", "reasoning_text"])
  for (const field of fields) {
    if (field === undefined) continue
    const text = delta[field]
    if (typeof text === "string" && text.length > 0) return { field, text }
  }
  return undefined
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
    if (event.error)
      return yield* new AIError({
        module: ADAPTER,
        method: "stream",
        reason: classifyProviderFailure({
          message: event.error.message,
          code: event.error.code === undefined || event.error.code === null ? undefined : String(event.error.code),
          status: typeof event.error.code === "number" ? event.error.code : undefined,
        }),
      })
    const events: LLMEvent[] = []
    const usage = mapUsage(event.usage) ?? state.usage
    const choice = event.choices?.[0]
    const finishReason = choice?.finish_reason
      ? { normalized: mapFinishReason(choice.finish_reason), raw: choice.native_finish_reason ?? choice.finish_reason }
      : state.finishReason
    const delta = choice?.delta
    const toolDeltas = delta?.tool_calls ?? []
    let tools = state.tools
    let pendingTools = state.pendingTools

    let lifecycle = state.lifecycle

    const reasoning = reasoningDelta(delta, state.reasoningField)
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

    for (const [position, tool] of toolDeltas.entries()) {
      const index = tool.index ?? position
      const current = tools[index]
      const pending = pendingTools[index]
      const id = current?.id ?? pending?.id ?? (tool.id || undefined)
      const name = current?.name ?? pending?.name ?? (tool.function?.name || undefined)
      const text = `${pending?.input ?? ""}${tool.function?.arguments ?? ""}`
      if (!current && (!id || !name)) {
        pendingTools = { ...pendingTools, [index]: { id: id || undefined, name: name || undefined, input: text } }
        continue
      }
      if (pending) {
        pendingTools = { ...pendingTools }
        delete pendingTools[index]
      }
      const result = ToolStream.appendOrStart(
        ADAPTER,
        tools,
        index,
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
  const reason = state.finishReason
    ? {
        ...state.finishReason,
        normalized:
          state.finishReason.normalized === "stop" && hasToolCalls ? "tool-calls" : state.finishReason.normalized,
      }
    : undefined
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
    initial: (request) => ({
      tools: ToolStream.empty<number>(),
      pendingTools: {},
      toolCallEvents: [],
      lifecycle: Lifecycle.initial(),
      reasoningField: request.model.compatibility?.reasoningField,
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
