import { Effect, Schema } from "effect"
import type { Content } from "@opencode-ai/schema/tool"
import { HttpTransport } from "../route/transport/index.js"
import { Protocol } from "../route/protocol.js"
import {
  AIError,
  LLMEvent,
  Usage,
  type FinishReason,
  type JsonSchema,
  type LLMRequest,
  type MediaPart,
  type ProviderMetadata,
  type ReasoningPart,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from "../schema/index.js"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared.js"
import { classifyProviderFailure } from "../provider-error.js"
import { OpenResponsesOptions } from "./utils/open-responses-options.js"
import { Lifecycle } from "./utils/lifecycle.js"
import { ToolSchemaProjection } from "./utils/tool-schema.js"
import { ToolStream } from "./utils/tool-stream.js"

const ADAPTER = "open-responses"
const NAME = "Open Responses"
export const PATH = "/responses"

// =============================================================================
// Request Body Schema
// =============================================================================
const OpenResponsesInputText = Schema.Struct({
  type: Schema.tag("input_text"),
  text: Schema.String,
})
const OpenResponsesInputImage = Schema.Struct({
  type: Schema.tag("input_image"),
  image_url: Schema.String,
})
const OpenResponsesInputFile = Schema.Struct({
  type: Schema.tag("input_file"),
  filename: Schema.String,
  file_data: Schema.String,
  mime_type: Schema.optional(Schema.String),
})
const MediaInput = Schema.Union([OpenResponsesInputImage, OpenResponsesInputFile])
export type MediaInput = Schema.Schema.Type<typeof MediaInput>
const OpenResponsesInputContent = Schema.Union([OpenResponsesInputText, MediaInput])

const OpenResponsesOutputText = Schema.Struct({
  type: Schema.tag("output_text"),
  text: Schema.String,
})

export const MessagePhase = Schema.Literals(["commentary", "final_answer"])
type MessagePhase = Schema.Schema.Type<typeof MessagePhase>

const OpenResponsesReasoningSummaryText = Schema.Struct({
  type: Schema.tag("summary_text"),
  text: Schema.String,
})

const OpenResponsesReasoningItem = Schema.Struct({
  type: Schema.tag("reasoning"),
  id: Schema.optionalKey(Schema.String),
  summary: Schema.Array(OpenResponsesReasoningSummaryText),
  encrypted_content: optionalNull(Schema.String),
})

const OpenResponsesItemReference = Schema.Struct({
  type: Schema.tag("item_reference"),
  id: Schema.String,
})

// `function_call_output.output` accepts either a plain string or an ordered
// array of content items so tools can return images and files in addition to text.
// https://www.openresponses.org/reference
const OpenResponsesFunctionCallOutputContent = Schema.Union([
  OpenResponsesInputText,
  OpenResponsesInputImage,
  OpenResponsesInputFile,
])

const OpenResponsesFunctionCallOutput = Schema.Union([
  Schema.String,
  Schema.Array(OpenResponsesFunctionCallOutputContent),
])

export const InputItem = Schema.Union([
  Schema.Struct({ role: Schema.tag("system"), content: Schema.String }),
  Schema.Struct({ role: Schema.tag("developer"), content: Schema.String }),
  Schema.Struct({ role: Schema.tag("user"), content: Schema.Array(OpenResponsesInputContent) }),
  Schema.Struct({
    type: Schema.tag("message"),
    id: Schema.optionalKey(Schema.String),
    role: Schema.tag("assistant"),
    content: Schema.Array(OpenResponsesOutputText),
    phase: Schema.optionalKey(MessagePhase),
  }),
  OpenResponsesReasoningItem,
  OpenResponsesItemReference,
  Schema.Struct({
    type: Schema.tag("function_call"),
    id: Schema.optionalKey(Schema.String),
    call_id: Schema.String,
    name: Schema.String,
    arguments: Schema.String,
  }),
  Schema.Struct({
    type: Schema.tag("function_call_output"),
    call_id: Schema.String,
    output: OpenResponsesFunctionCallOutput,
  }),
])
type OpenResponsesInputItem = Schema.Schema.Type<typeof InputItem>
type LoweredInputItem =
  | OpenResponsesInputItem
  | {
      readonly type: "message"
      readonly id?: string
      readonly role: "assistant"
      readonly content: ReadonlyArray<{ readonly type: "output_text"; readonly text: string }>
      readonly phase?: MessagePhase | null
    }

// Mutable counterpart of the schema reasoning item so `lowerMessages` can fold
// multiple streamed summary parts into the same item before flushing.
type OpenResponsesReasoningInput = {
  type: "reasoning"
  id: string
  summary: Array<{ type: "summary_text"; text: string }>
  encrypted_content?: string | null
}
export const Tool = Schema.Struct({
  type: Schema.tag("function"),
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
  strict: Schema.optional(Schema.Boolean),
})

export const ToolChoice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({ type: Schema.tag("function"), name: Schema.String }),
  Schema.Struct({
    type: Schema.tag("allowed_tools"),
    mode: Schema.Literals(["auto", "none", "required"]),
    tools: Schema.Array(Schema.Struct({ type: Schema.tag("function"), name: Schema.String })),
  }),
])

// Fields shared between the HTTP body and the WebSocket `response.create`
// message. The HTTP body adds `stream: true`; the WebSocket message adds
// `type: "response.create"`. Defining the shared shape once keeps the two
// transports in sync without a destructure-and-strip dance.
export const coreFields = {
  model: Schema.String,
  input: Schema.Array(InputItem),
  instructions: Schema.optional(Schema.String),
  tools: optionalArray(Tool),
  tool_choice: Schema.optional(ToolChoice),
  store: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  safety_identifier: Schema.optional(Schema.String),
  stream_options: Schema.optional(
    Schema.Struct({
      include_obfuscation: Schema.optional(Schema.Boolean),
    }),
  ),
  top_logprobs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 }))),
  truncation: Schema.optional(OpenResponsesOptions.TruncationSchema),
  service_tier: Schema.optional(OpenResponsesOptions.ServiceTierSchema),
  prompt_cache_key: Schema.optional(Schema.String),
  include: optionalArray(OpenResponsesOptions.ResponseIncludableSchema),
  reasoning: Schema.optional(
    Schema.Struct({
      effort: Schema.optional(OpenResponsesOptions.ReasoningEffort),
      summary: Schema.optional(Schema.Literals(["auto", "concise", "detailed"])),
    }),
  ),
  text: Schema.optional(
    Schema.Struct({
      verbosity: Schema.optional(OpenResponsesOptions.TextVerbositySchema),
    }),
  ),
  max_output_tokens: Schema.optional(Schema.Number),
  max_tool_calls: Schema.optional(Schema.Int),
  parallel_tool_calls: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  presence_penalty: Schema.optional(Schema.Number),
  frequency_penalty: Schema.optional(Schema.Number),
}

const OpenResponsesBody = Schema.Struct({
  ...coreFields,
  stream: Schema.Literal(true),
})
export type OpenResponsesBody = Schema.Schema.Type<typeof OpenResponsesBody>

const OpenResponsesUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  input_tokens_details: optionalNull(
    Schema.Struct({
      cached_tokens: Schema.optional(Schema.Number),
      cache_write_tokens: Schema.optional(Schema.Number),
    }),
  ),
  output_tokens: Schema.optional(Schema.Number),
  output_tokens_details: optionalNull(Schema.Struct({ reasoning_tokens: Schema.optional(Schema.Number) })),
  total_tokens: Schema.optional(Schema.Number),
})
type OpenResponsesUsage = Schema.Schema.Type<typeof OpenResponsesUsage>

export const StreamItem = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    id: Schema.optional(Schema.String),
    call_id: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    arguments: Schema.optional(Schema.String),
    encrypted_content: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export type StreamItem = Schema.Schema.Type<typeof StreamItem>

// The Responses schema puts streaming error details at the top level and
// response failures under `response.error`. WebSocket failures use an
// event-level `error` envelope, so accept all three shapes here.
// https://www.openresponses.org/specification
const OpenResponsesErrorPayload = Schema.Struct({
  type: optionalNull(Schema.String),
  code: optionalNull(Schema.String),
  message: optionalNull(Schema.String),
  param: optionalNull(Schema.String),
})

const WebSocketErrorHeader = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
export const WebSocketErrorEvent = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag("error"),
    status: Schema.optional(Schema.Number),
    status_code: Schema.optional(Schema.Number),
    code: optionalNull(Schema.String),
    message: Schema.optional(Schema.String),
    param: optionalNull(Schema.String),
    error: optionalNull(OpenResponsesErrorPayload),
    headers: Schema.optional(Schema.Record(Schema.String, WebSocketErrorHeader)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const decodeWebSocketErrorEvent = Schema.decodeUnknownEffect(WebSocketErrorEvent)

export const decodeKnownErrorEvent = (event: Event) =>
  decodeWebSocketErrorEvent({
    ...event,
    status: typeof event.status === "number" ? event.status : undefined,
    status_code: typeof event.status_code === "number" ? event.status_code : undefined,
    headers: ProviderShared.isRecord(event.headers)
      ? Object.fromEntries(
          Object.entries(event.headers).filter(
            (entry): entry is [string, string | number | boolean] =>
              typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
          ),
        )
      : undefined,
  })

export const Event = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    delta: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
    item_id: Schema.optional(Schema.String),
    summary_index: Schema.optional(Schema.Number),
    item: Schema.optional(StreamItem),
    response: Schema.optional(
      Schema.StructWithRest(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          service_tier: optionalNull(Schema.String),
          incomplete_details: optionalNull(Schema.Struct({ reason: Schema.optional(Schema.String) })),
          usage: optionalNull(OpenResponsesUsage),
          error: optionalNull(OpenResponsesErrorPayload),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
    code: optionalNull(Schema.String),
    message: Schema.optional(Schema.String),
    param: optionalNull(Schema.String),
    error: optionalNull(OpenResponsesErrorPayload),
    status: Schema.optional(Schema.Unknown),
    status_code: Schema.optional(Schema.Unknown),
    headers: Schema.optional(Schema.Unknown),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export type Event = Schema.Schema.Type<typeof Event>

const RefusalEvent = Schema.Union([
  Schema.Struct({
    type: Schema.tag("response.refusal.delta"),
    item_id: Schema.String,
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.tag("response.refusal.done"),
    item_id: Schema.String,
    refusal: Schema.String,
  }),
])
const isRefusalEvent = Schema.is(RefusalEvent)

export interface Extension {
  readonly id: string
  readonly name: string
  readonly lowerMedia?: (input: {
    readonly part: MediaPart
    readonly media: ProviderShared.NormalizedMedia
    readonly request: LLMRequest
  }) => MediaInput | undefined
  readonly messagePhase?: (value: unknown) => MessagePhase | null | undefined
}

const BASE: Extension = { id: ADAPTER, name: NAME }

export interface ParserState {
  readonly id: string
  readonly name: string
  readonly providerMetadataKey: string
  readonly tools: ToolStream.State<string>
  readonly hasFunctionCall: boolean
  readonly lifecycle: Lifecycle.State
  readonly messageItems: ReadonlySet<string>
  readonly messagePhase: (value: unknown) => MessagePhase | null | undefined
  readonly messagePhases: Readonly<Record<string, MessagePhase | null>>
  readonly reasoningItems: Readonly<Record<string, ReasoningStreamItem>>
  readonly store: boolean | undefined
}

type ReasoningSummaryStatus = "active" | "can-conclude" | "concluded"

interface ReasoningStreamItem {
  readonly encryptedContent: string | null | undefined
  // Keyed by the wire protocol's numeric `summary_index`. JS object keys coerce to
  // strings, but typing the map as `Record<number, ...>` documents intent
  // and matches the wire field.
  readonly summaryParts: Readonly<Record<number, ReasoningSummaryStatus>>
}

// =============================================================================
// Request Lowering
// =============================================================================
export const lowerTool = Effect.fn("OpenResponses.lowerTool")(function* (
  protocolName: string,
  tool: ToolDefinition,
  inputSchema: JsonSchema,
) {
  if (tool.native !== undefined)
    return yield* ProviderShared.invalidRequest(`${protocolName} does not support provider-native tool ${tool.name}`)
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: ToolSchemaProjection.responses(inputSchema),
    // The common tool definition does not currently express Responses strict-schema policy.
    strict: false,
  }
})

export const lowerToolChoice = (protocolName: string, toolChoice: NonNullable<LLMRequest["toolChoice"]>) =>
  ProviderShared.matchToolChoice(protocolName, toolChoice, {
    auto: () => "auto" as const,
    none: () => "none" as const,
    required: () => "required" as const,
    tool: (toolName) => ({ type: "function" as const, name: toolName }),
  })

const itemID = (providerMetadata: ProviderMetadata | undefined, providerMetadataKey: string) => {
  const metadata = providerMetadata?.[providerMetadataKey]
  return ProviderShared.isRecord(metadata) && typeof metadata.itemId === "string" && metadata.itemId.length > 0
    ? metadata.itemId
    : undefined
}

const lowerToolCall = (part: ToolCallPart, providerMetadataKey: string): OpenResponsesInputItem => {
  const id = itemID(part.providerMetadata, providerMetadataKey)
  return {
    type: "function_call",
    ...(id ? { id } : {}),
    call_id: part.id,
    name: part.name,
    arguments: ProviderShared.encodeJson(part.input),
  }
}

const lowerReasoning = (part: ReasoningPart, providerMetadataKey: string): OpenResponsesReasoningInput | undefined => {
  const metadata = part.providerMetadata?.[providerMetadataKey]
  const id = itemID(part.providerMetadata, providerMetadataKey)
  if (!ProviderShared.isRecord(metadata) || !id) return undefined
  const encryptedContent =
    typeof metadata.reasoningEncryptedContent === "string" || metadata.reasoningEncryptedContent === null
      ? metadata.reasoningEncryptedContent
      : undefined
  return {
    type: "reasoning",
    id,
    summary: part.text.length > 0 ? [{ type: "summary_text", text: part.text }] : [],
    encrypted_content: encryptedContent,
  }
}

const hostedToolItemID = (part: ToolResultPart, providerMetadataKey: string) => {
  return itemID(part.providerMetadata, providerMetadataKey)
}

const lowerMedia = Effect.fn("OpenResponses.lowerMedia")(function* (
  part: MediaPart,
  request: LLMRequest,
  extension: Extension,
) {
  const media = ProviderShared.normalizeMedia(part)
  const extended = extension.lowerMedia?.({ part, media, request })
  if (extended) return extended
  if (!media.mime.startsWith("image/")) {
    return {
      type: "input_file" as const,
      filename: part.filename ?? (media.mime === "application/pdf" ? "document.pdf" : "file"),
      file_data: media.dataUrl,
    }
  }
  return { type: "input_image" as const, image_url: media.dataUrl }
})

const lowerUserContent = Effect.fnUntraced(function* (
  part: LLMRequest["messages"][number]["content"][number],
  request: LLMRequest,
  extension: Extension,
) {
  if (part.type === "text") return { type: "input_text" as const, text: part.text }
  if (part.type === "media") return yield* lowerMedia(part, request, extension)
  return yield* ProviderShared.unsupportedContent(extension.name, "user", ["text", "media"])
})

// Tool results may carry structured text, images, and files. Keep media as provider-native
// content instead of JSON-stringifying base64 into a prompt string.
const lowerToolResultContentItem = Effect.fnUntraced(function* (
  item: Content,
  request: LLMRequest,
  extension: Extension,
) {
  if (item.type === "text") return { type: "input_text" as const, text: item.text }
  return yield* lowerMedia(
    { type: "media", mediaType: item.mime, data: item.uri, filename: item.name },
    request,
    extension,
  )
})

const lowerToolResultOutput = Effect.fnUntraced(function* (
  part: ToolResultPart,
  request: LLMRequest,
  extension: Extension,
) {
  // Text/json/error results are encoded as a plain string for backward
  // compatibility with existing cassettes and provider expectations.
  if (part.result.type !== "content") return ProviderShared.toolResultText(part)
  // Preserve the narrowed array element type when compiled through a consumer package.
  const content: ReadonlyArray<Content> = part.result.value
  return yield* Effect.forEach(content, (item) => lowerToolResultContentItem(item, request, extension))
})

const lowerMessages = Effect.fn("OpenResponses.lowerMessages")(function* (request: LLMRequest, extension: Extension) {
  const system: LoweredInputItem[] =
    request.system.length === 0 ? [] : [{ role: "system", content: ProviderShared.joinText(request.system) }]
  const input: LoweredInputItem[] = [...system]
  const store = OpenResponsesOptions.resolve(request).store
  const providerMetadataKey = request.model.route.providerMetadataKey ?? "openresponses"

  for (const message of request.messages) {
    if (message.role === "system") {
      input.push({
        role: "developer",
        content: ProviderShared.joinText(yield* ProviderShared.systemUpdateText(extension.name, message)),
      })
      continue
    }

    if (message.role === "user") {
      input.push({
        role: "user",
        content: yield* Effect.forEach(message.content, (part) => lowerUserContent(part, request, extension)),
      })
      continue
    }

    if (message.role === "assistant") {
      const content: TextPart[] = []
      const reasoningItems: Record<string, OpenResponsesReasoningInput> = {}
      const reasoningReferences = new Set<string>()
      const hostedToolReferences = new Set<string>()
      const flushText = () => {
        if (content.length === 0) return
        const groups = content.reduce<
          Array<{ id: string | undefined; phase: MessagePhase | null | undefined; parts: TextPart[] }>
        >((groups, part) => {
          const metadata = part.providerMetadata?.[providerMetadataKey]
          const id = itemID(part.providerMetadata, providerMetadataKey)
          const phase = ProviderShared.isRecord(metadata) ? messagePhase(metadata.phase, extension) : undefined
          const group = groups.at(-1)
          if (group && group.id === id && group.phase === phase) group.parts.push(part)
          else groups.push({ id, phase, parts: [part] })
          return groups
        }, [])
        input.push(
          ...groups.map((group) => ({
            type: "message" as const,
            ...(group.id === undefined ? {} : { id: group.id }),
            role: "assistant" as const,
            content: group.parts.map((part) => ({ type: "output_text" as const, text: part.text })),
            ...(group.phase === undefined ? {} : { phase: group.phase }),
          })),
        )
        content.splice(0, content.length)
      }
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(part)
          continue
        }
        if (part.type === "reasoning") {
          flushText()
          const reasoning = lowerReasoning(part, providerMetadataKey)
          if (!reasoning) continue
          if (store !== false) {
            if (!reasoningReferences.has(reasoning.id)) input.push({ type: "item_reference", id: reasoning.id })
            reasoningReferences.add(reasoning.id)
            continue
          }
          const existing = reasoningItems[reasoning.id]
          if (existing) {
            existing.summary.push(...reasoning.summary)
            if (typeof reasoning.encrypted_content === "string")
              existing.encrypted_content = reasoning.encrypted_content
            continue
          }
          reasoningItems[reasoning.id] = reasoning
          input.push(reasoning)
          continue
        }
        if (part.type === "tool-call") {
          flushText()
          if (part.providerExecuted === true) continue
          input.push(lowerToolCall(part, providerMetadataKey))
          continue
        }
        if (part.type === "tool-result" && part.providerExecuted === true) {
          flushText()
          const itemID = hostedToolItemID(part, providerMetadataKey)
          if (store !== false && itemID && !hostedToolReferences.has(itemID))
            input.push({ type: "item_reference", id: itemID })
          if (store === false && part.result.type === "content") {
            const content: ReadonlyArray<Content> = part.result.value
            input.push({
              role: "user",
              content: yield* Effect.forEach(content, (item) => lowerToolResultContentItem(item, request, extension)),
            })
          }
          if (itemID) hostedToolReferences.add(itemID)
          continue
        }
        return yield* ProviderShared.unsupportedContent(extension.name, "assistant", [
          "text",
          "reasoning",
          "tool-call",
          "tool-result",
        ])
      }
      flushText()
      continue
    }

    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ["tool-result"]))
        return yield* ProviderShared.unsupportedContent(extension.name, "tool", ["tool-result"])
      input.push({
        type: "function_call_output",
        call_id: part.id,
        output: yield* lowerToolResultOutput(part, request, extension),
      })
    }
  }

  // With store:false, Responses APIs only accept previous reasoning items when the
  // complete item has encrypted state. Summary blocks for one item may carry
  // that state only on the last block, so filter after they have been joined.
  return store === false
    ? input.filter(
        (item) => !("type" in item) || item.type !== "reasoning" || typeof item.encrypted_content === "string",
      )
    : input
})

const lowerOptions = (request: LLMRequest) => {
  const options = OpenResponsesOptions.resolve(request)
  return {
    ...(options.instructions ? { instructions: options.instructions } : {}),
    ...(options.store !== undefined ? { store: options.store } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.safetyIdentifier ? { safety_identifier: options.safetyIdentifier } : {}),
    ...(options.streamOptions?.includeObfuscation !== undefined
      ? { stream_options: { include_obfuscation: options.streamOptions.includeObfuscation } }
      : {}),
    ...(options.topLogprobs !== undefined ? { top_logprobs: options.topLogprobs } : {}),
    ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
    ...(options.include ? { include: options.include } : {}),
    ...(options.reasoningEffort || options.reasoningSummary
      ? { reasoning: { effort: options.reasoningEffort, summary: options.reasoningSummary } }
      : {}),
    ...(options.textVerbosity ? { text: { verbosity: options.textVerbosity } } : {}),
    ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
    ...(options.maxToolCalls !== undefined ? { max_tool_calls: options.maxToolCalls } : {}),
    ...(options.parallelToolCalls !== undefined ? { parallel_tool_calls: options.parallelToolCalls } : {}),
    ...(options.truncation ? { truncation: options.truncation } : {}),
  }
}

const allowedToolChoice = (request: LLMRequest) => {
  const allowed = OpenResponsesOptions.resolve(request).allowedTools
  if (!allowed) return undefined
  return {
    type: "allowed_tools" as const,
    mode: allowed.mode,
    tools: allowed.toolNames.map((name) => ({ type: "function" as const, name })),
  }
}

export const fromRequestWithExtension = Effect.fn("OpenResponses.fromRequestWithExtension")(function* (
  request: LLMRequest,
  extension: Extension,
) {
  const generation = request.generation
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema
  return {
    model: request.model.id,
    input: yield* lowerMessages(request, extension),
    tools:
      request.tools.length === 0
        ? undefined
        : yield* Effect.forEach(request.tools, (tool) =>
            lowerTool(
              extension.name,
              tool,
              ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility),
            ),
          ),
    tool_choice:
      allowedToolChoice(request) ??
      (request.toolChoice ? yield* lowerToolChoice(extension.name, request.toolChoice) : undefined),
    stream: true as const,
    max_output_tokens: generation?.maxTokens,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    presence_penalty: generation?.presencePenalty,
    frequency_penalty: generation?.frequencyPenalty,
    ...lowerOptions(request),
  }
})

const decodeBody = ProviderShared.validateWith(Schema.decodeUnknownEffect(OpenResponsesBody))

export const fromRequest = Effect.fn("OpenResponses.fromRequest")(function* (request: LLMRequest) {
  return yield* decodeBody(yield* fromRequestWithExtension(request, BASE))
})

// =============================================================================
// Stream Parsing
// =============================================================================
// Responses APIs report `input_tokens` (inclusive total) with a
// cached-read and cache-write subsets, and `output_tokens` (inclusive total)
// with a `reasoning_tokens` subset. Pass the totals through and derive the
// non-cached breakdown.
const mapUsage = (usage: OpenResponsesUsage | null | undefined, providerMetadataKey: string) => {
  if (!usage) return undefined
  const cached = usage.input_tokens_details?.cached_tokens
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens
  const reasoning = usage.output_tokens_details?.reasoning_tokens
  const nonCached = ProviderShared.subtractTokens(usage.input_tokens, ProviderShared.sumTokens(cached, cacheWrite))
  return new Usage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    reasoningTokens: reasoning,
    totalTokens: ProviderShared.totalTokens(usage.input_tokens, usage.output_tokens, usage.total_tokens),
    providerMetadata: { [providerMetadataKey]: usage },
  })
}

const mapFinishReason = (event: Event, hasFunctionCall: boolean): FinishReason => {
  const reason = event.response?.incomplete_details?.reason
  if (reason === undefined || reason === null) {
    if (hasFunctionCall) return "tool-calls"
    if (event.type === "response.incomplete") return "unknown"
    return "stop"
  }
  if (reason === "max_output_tokens") return "length"
  if (reason === "content_filter") return "content-filter"
  return hasFunctionCall ? "tool-calls" : "unknown"
}

export const providerMetadata = (state: ParserState, metadata: Record<string, unknown>): ProviderMetadata => ({
  [state.providerMetadataKey]: metadata,
})

const isReasoningItem = (item: StreamItem): item is StreamItem & { type: "reasoning"; id: string } =>
  item.type === "reasoning" && typeof item.id === "string" && item.id.length > 0

export type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>]

const NO_EVENTS: StepResult["1"] = []

// `response.completed` / `response.incomplete` are clean finishes that emit a
// `finish` event; `response.failed` and `error` are hard failures. All four end
// the stream, so keep this set aligned with `step` and the protocol's terminal predicate.
const TERMINAL_TYPES = new Set(["error", "response.completed", "response.incomplete", "response.failed"])
export const terminal = (event: Event) => TERMINAL_TYPES.has(event.type)

const onOutputTextDelta = (state: ParserState, event: Event, id: string): StepResult => {
  if (!event.delta) return [state, NO_EVENTS]
  const events: LLMEvent[] = []
  const phase = state.messagePhases[id]
  const metadata = providerMetadata(state, { itemId: id, ...(phase === undefined ? {} : { phase }) })
  const lifecycle = Lifecycle.textStart(state.lifecycle, events, id, metadata)
  return [{ ...state, lifecycle: Lifecycle.textDelta(lifecycle, events, id, event.delta) }, events]
}

const onOutputTextDone = (state: ParserState, event: Event, id: string): StepResult => {
  if (state.messageItems.has(id)) {
    if (state.lifecycle.text.has(id) || event.text === undefined) return [state, NO_EVENTS]
    return onOutputTextDelta(state, { ...event, delta: event.text }, id)
  }
  const events: LLMEvent[] = []
  return [{ ...state, lifecycle: Lifecycle.textEnd(state.lifecycle, events, id) }, events]
}

export const onReasoningDelta = (state: ParserState, event: Event, itemID: string): StepResult => {
  if (!event.delta) return [state, NO_EVENTS]
  const events: LLMEvent[] = []
  const id =
    event.summary_index !== undefined || state.reasoningItems[itemID] ? `${itemID}:${event.summary_index ?? 0}` : itemID
  return [
    {
      ...state,
      lifecycle: Lifecycle.reasoningDelta(state.lifecycle, events, id, event.delta),
    },
    events,
  ]
}

export const onReasoningDone = (state: ParserState, _event: Event): StepResult => [state, NO_EVENTS]

const reasoningMetadata = (state: ParserState, item: StreamItem & { id: string }) =>
  providerMetadata(state, { itemId: item.id, reasoningEncryptedContent: item.encrypted_content ?? null })

// Responses APIs stream reasoning items in a stable order:
//   `output_item.added` (reasoning) →
//     `reasoning_summary_part.added` (index=0) →
//     `reasoning_summary_text.delta` →
//     `reasoning_summary_part.done` (index=0) →
//     (repeat for index>0) →
//   `output_item.done` (reasoning).
// The handlers below rely on this ordering: `onOutputItemAdded` seeds the
// per-item entry, `onReasoningSummaryPartAdded` for `summary_index === 0`
// short-circuits when the entry already exists, and higher-index handlers
// fold against the same entry. Behaviour for out-of-order events is
// best-effort, not guaranteed.
const onOutputItemAdded = (state: ParserState, event: Event): StepResult => {
  const item = event.item
  if (item?.type === "message" && item.id)
    return [
      {
        ...state,
        messageItems: new Set([...state.messageItems, item.id]),
        messagePhases: (() => {
          const phase = state.messagePhase(item.phase)
          return phase === undefined ? state.messagePhases : { ...state.messagePhases, [item.id]: phase }
        })(),
      },
      NO_EVENTS,
    ]
  if (item && isReasoningItem(item)) {
    const events: LLMEvent[] = []
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningStart(state.lifecycle, events, `${item.id}:0`, reasoningMetadata(state, item)),
        reasoningItems: {
          ...state.reasoningItems,
          [item.id]: { encryptedContent: item.encrypted_content, summaryParts: { 0: "active" } },
        },
      },
      events,
    ]
  }
  if (item?.type !== "function_call" || !item.id) return [state, NO_EVENTS]
  const metadata = providerMetadata(state, { itemId: item.id })
  const events: LLMEvent[] = []
  const lifecycle = Lifecycle.stepStart(state.lifecycle, events)
  return [
    {
      ...state,
      lifecycle,
      tools: ToolStream.start(state.tools, item.id, {
        id: item.call_id ?? item.id,
        name: item.name ?? "",
        input: item.arguments ?? "",
        providerMetadata: metadata,
      }),
    },
    [
      ...events,
      LLMEvent.toolInputStart({ id: item.call_id ?? item.id, name: item.name ?? "", providerMetadata: metadata }),
    ],
  ]
}

const onReasoningSummaryPartAdded = (state: ParserState, event: Event): StepResult => {
  if (!event.item_id || event.summary_index === undefined) return [state, NO_EVENTS]
  const item = state.reasoningItems[event.item_id] ?? { encryptedContent: undefined, summaryParts: {} }
  if (event.summary_index === 0) {
    if (state.reasoningItems[event.item_id]) return [state, NO_EVENTS]
    const events: LLMEvent[] = []
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningStart(
          state.lifecycle,
          events,
          `${event.item_id}:0`,
          providerMetadata(state, { itemId: event.item_id, reasoningEncryptedContent: null }),
        ),
        reasoningItems: {
          ...state.reasoningItems,
          [event.item_id]: { ...item, summaryParts: { 0: "active" } },
        },
      },
      events,
    ]
  }

  const events: LLMEvent[] = []
  const closed = Object.entries(item.summaryParts)
    .filter((entry) => entry[1] === "can-conclude")
    .reduce(
      (lifecycle, entry) =>
        Lifecycle.reasoningEnd(
          lifecycle,
          events,
          `${event.item_id}:${entry[0]}`,
          providerMetadata(state, { itemId: event.item_id }),
        ),
      state.lifecycle,
    )
  return [
    {
      ...state,
      lifecycle: Lifecycle.reasoningStart(
        closed,
        events,
        `${event.item_id}:${event.summary_index}`,
        providerMetadata(state, { itemId: event.item_id, reasoningEncryptedContent: item.encryptedContent ?? null }),
      ),
      reasoningItems: {
        ...state.reasoningItems,
        [event.item_id]: {
          ...item,
          summaryParts: {
            ...Object.fromEntries(
              Object.entries(item.summaryParts).map((entry) =>
                entry[1] === "can-conclude" ? [entry[0], "concluded" as const] : entry,
              ),
            ),
            [event.summary_index]: "active",
          },
        },
      },
    },
    events,
  ]
}

const onReasoningSummaryPartDone = (state: ParserState, event: Event): StepResult => {
  if (!event.item_id || event.summary_index === undefined) return [state, NO_EVENTS]
  const item = state.reasoningItems[event.item_id]
  if (!item) return [state, NO_EVENTS]
  const events: LLMEvent[] = []
  return [
    {
      ...state,
      lifecycle:
        state.store !== false
          ? Lifecycle.reasoningEnd(
              state.lifecycle,
              events,
              `${event.item_id}:${event.summary_index}`,
              providerMetadata(state, { itemId: event.item_id }),
            )
          : state.lifecycle,
      reasoningItems: {
        ...state.reasoningItems,
        [event.item_id]: {
          ...item,
          summaryParts: {
            ...item.summaryParts,
            [event.summary_index]: state.store !== false ? "concluded" : "can-conclude",
          },
        },
      },
    },
    events,
  ]
}

const onFunctionCallArgumentsDelta = Effect.fn("OpenResponses.onFunctionCallArgumentsDelta")(function* (
  state: ParserState,
  event: Event,
) {
  if (!event.item_id || !event.delta) return [state, NO_EVENTS] satisfies StepResult
  const result = ToolStream.appendExisting(
    state.id,
    state.tools,
    event.item_id,
    event.delta,
    `${state.name} tool argument delta is missing its tool call`,
  )
  if (ToolStream.isError(result)) return yield* result
  const events: LLMEvent[] = []
  const lifecycle = result.events.length ? Lifecycle.stepStart(state.lifecycle, events) : state.lifecycle
  events.push(...result.events)
  return [{ ...state, lifecycle, tools: result.tools }, events] satisfies StepResult
})

const onOutputItemDone = Effect.fn("OpenResponses.onOutputItemDone")(function* (state: ParserState, event: Event) {
  const item = event.item
  if (!item) return [state, NO_EVENTS] satisfies StepResult

  if (item.type === "message" && item.id) {
    const itemPhase = state.messagePhase(item.phase)
    const phase = itemPhase === undefined ? state.messagePhases[item.id] : itemPhase
    const events: LLMEvent[] = []
    const messageItems = new Set(state.messageItems)
    messageItems.delete(item.id)
    const { [item.id]: _phase, ...messagePhases } = state.messagePhases
    return [
      {
        ...state,
        lifecycle: Lifecycle.textEnd(
          state.lifecycle,
          events,
          item.id,
          providerMetadata(state, { itemId: item.id, ...(phase === undefined ? {} : { phase }) }),
        ),
        messageItems,
        messagePhases,
      },
      events,
    ] satisfies StepResult
  }

  if (item.type === "function_call") {
    if (!item.id || !item.call_id || !item.name) return [state, NO_EVENTS] satisfies StepResult
    const tools = state.tools[item.id]
      ? state.tools
      : ToolStream.start(state.tools, item.id, {
          id: item.call_id,
          name: item.name,
          providerMetadata: providerMetadata(state, { itemId: item.id }),
        })
    const result =
      item.arguments === undefined
        ? yield* ToolStream.finish(state.id, tools, item.id)
        : yield* ToolStream.finishWithInput(state.id, tools, item.id, item.arguments)
    const events: LLMEvent[] = []
    const resultEvents = result.events ?? []
    const lifecycle = resultEvents.length ? Lifecycle.stepStart(state.lifecycle, events) : state.lifecycle
    events.push(...resultEvents)
    return [
      {
        ...state,
        lifecycle,
        hasFunctionCall:
          resultEvents.some((event) => LLMEvent.is.toolCall(event) || LLMEvent.is.toolInputError(event)) ||
          state.hasFunctionCall,
        tools: result.tools,
      },
      events,
    ] satisfies StepResult
  }

  if (isReasoningItem(item)) {
    const events: LLMEvent[] = []
    const metadata = reasoningMetadata(state, item)
    const reasoningItem = state.reasoningItems[item.id]
    if (reasoningItem) {
      const lifecycle = Object.entries(reasoningItem.summaryParts)
        .filter((entry) => entry[1] === "active" || entry[1] === "can-conclude")
        .reduce(
          (lifecycle, entry) => Lifecycle.reasoningEnd(lifecycle, events, `${item.id}:${entry[0]}`, metadata),
          state.lifecycle,
        )
      const { [item.id]: _removed, ...reasoningItems } = state.reasoningItems
      return [{ ...state, lifecycle, reasoningItems }, events] satisfies StepResult
    }
    if (!state.lifecycle.reasoning.has(item.id)) {
      const lifecycle = Lifecycle.stepStart(state.lifecycle, events)
      events.push(LLMEvent.reasoningStart({ id: item.id, providerMetadata: metadata }))
      events.push(LLMEvent.reasoningEnd({ id: item.id, providerMetadata: metadata }))
      return [{ ...state, lifecycle }, events] satisfies StepResult
    }
    return [
      { ...state, lifecycle: Lifecycle.reasoningEnd(state.lifecycle, events, item.id, metadata) },
      events,
    ] satisfies StepResult
  }

  return [state, NO_EVENTS] satisfies StepResult
})

const onResponseFinish = Effect.fn("OpenResponses.onResponseFinish")(function* (state: ParserState, event: Event) {
  // Some compatible providers omit output_item.done even after completing the response.
  const pending =
    event.type === "response.completed"
      ? yield* ToolStream.finishAll(state.id, state.tools)
      : { tools: state.tools, events: NO_EVENTS }
  const events: LLMEvent[] = [...pending.events]
  const hasFunctionCall =
    pending.events.some((event) => LLMEvent.is.toolCall(event) || LLMEvent.is.toolInputError(event)) ||
    state.hasFunctionCall
  const lifecycle = Lifecycle.finish(state.lifecycle, events, {
    reason: {
      normalized: mapFinishReason(event, hasFunctionCall),
      raw: event.response?.incomplete_details?.reason,
    },
    usage: mapUsage(event.response?.usage, state.providerMetadataKey),
    providerMetadata:
      event.response?.id || event.response?.service_tier
        ? providerMetadata(state, {
            responseId: event.response.id,
            serviceTier: event.response.service_tier,
          })
        : undefined,
  })
  return [{ ...state, lifecycle, hasFunctionCall, tools: pending.tools }, events] satisfies StepResult
})

// Build a single human-readable message from whatever the provider supplied.
// When both code and message are present, prefix the code so consumers see
// the failure mode (e.g. `rate_limit_exceeded: Slow down`) instead of just
// the bare message — production rate limits and context-length failures used
// to be indistinguishable from generic stream drops.
const providerErrorMessage = (event: Event, fallback: string): string => {
  const nested = event.error ?? event.response?.error ?? undefined
  const message = event.message || nested?.message || undefined
  const code = event.code || nested?.code || undefined
  if (message && code) return `${code}: ${message}`
  return message || code || fallback
}

export const providerFailure = (id: string, event: Event, fallback: string) => {
  const code = event.code || event.error?.code || event.response?.error?.code || undefined
  const message = providerErrorMessage(event, fallback)
  const status =
    typeof event.status === "number"
      ? event.status
      : typeof event.status_code === "number"
        ? event.status_code
        : undefined
  return new AIError({
    module: id,
    method: "stream",
    reason: classifyProviderFailure({ message, code, status }),
  })
}

const providerError = (state: ParserState, event: Event, fallback: string) => providerFailure(state.id, event, fallback)

export const step = (state: ParserState, event: Event) => {
  if (event.type === "response.output_text.delta" || event.type === "response.output_text.done") {
    if (!event.item_id) return ProviderShared.eventError(state.id, `${event.type} is missing item_id`)
    return Effect.succeed(
      event.type === "response.output_text.delta"
        ? onOutputTextDelta(state, event, event.item_id)
        : onOutputTextDone(state, event, event.item_id),
    )
  }
  if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") {
    if (!isRefusalEvent(event)) return ProviderShared.eventError(state.id, `${event.type} is malformed`)
    return Effect.succeed(
      event.type === "response.refusal.delta"
        ? onOutputTextDelta(state, event, event.item_id)
        : onOutputTextDone(state, { ...event, text: event.refusal }, event.item_id),
    )
  }
  if (event.type === "response.reasoning.delta" || event.type === "response.reasoning_summary_text.delta") {
    if (!event.item_id) return ProviderShared.eventError(state.id, `${event.type} is missing item_id`)
    return Effect.succeed(onReasoningDelta(state, event, event.item_id))
  }
  if (event.type === "response.reasoning.done" || event.type === "response.reasoning_summary_text.done") {
    if (!event.item_id) return ProviderShared.eventError(state.id, `${event.type} is missing item_id`)
    return Effect.succeed(onReasoningDone(state, event))
  }
  if (event.type === "response.reasoning_summary_part.added")
    return event.item_id
      ? Effect.succeed(onReasoningSummaryPartAdded(state, event))
      : ProviderShared.eventError(state.id, `${event.type} is missing item_id`)
  if (event.type === "response.reasoning_summary_part.done")
    return event.item_id
      ? Effect.succeed(onReasoningSummaryPartDone(state, event))
      : ProviderShared.eventError(state.id, `${event.type} is missing item_id`)
  if (event.type === "response.output_item.added") {
    if (event.item?.type === "message" && !event.item.id)
      return ProviderShared.eventError(state.id, `${event.type} message is missing id`)
    return Effect.succeed(onOutputItemAdded(state, event))
  }
  if (event.type === "response.function_call_arguments.delta") return onFunctionCallArgumentsDelta(state, event)
  if (event.type === "response.output_item.done") {
    if (event.item?.type === "message" && !event.item.id)
      return ProviderShared.eventError(state.id, `${event.type} message is missing id`)
    return onOutputItemDone(state, event)
  }
  if (event.type === "response.completed" || event.type === "response.incomplete") return onResponseFinish(state, event)
  if (event.type === "response.failed") return providerError(state, event, `${state.name} response failed`)
  if (event.type === "error")
    return decodeKnownErrorEvent(event).pipe(
      Effect.mapError(() => ProviderShared.eventError(state.id, `${state.name} returned a malformed error event`)),
      Effect.flatMap(() => providerError(state, event, `${state.name} stream error`)),
    )
  return Effect.succeed<StepResult>([state, NO_EVENTS])
}

// =============================================================================
// Protocol
// =============================================================================
/**
 * The provider-neutral Open Responses protocol. Provider-specific Responses
 * implementations compose this baseline with their own tools and event variants.
 */
export const initial = (request: LLMRequest, extension: Extension = BASE): ParserState => ({
  id: extension.id,
  name: extension.name,
  providerMetadataKey: request.model.route.providerMetadataKey ?? "openresponses",
  hasFunctionCall: false,
  tools: ToolStream.empty<string>(),
  lifecycle: Lifecycle.initial(),
  messageItems: new Set<string>(),
  messagePhase: (value) => messagePhase(value, extension),
  messagePhases: {},
  reasoningItems: {},
  store: OpenResponsesOptions.resolve(request).store,
})

const messagePhase = (value: unknown, extension: Extension): MessagePhase | null | undefined => {
  if (value === "commentary" || value === "final_answer") return value
  return extension.messagePhase?.(value)
}

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenResponsesBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(Event),
    initial,
    step,
    terminal,
  },
})

export const httpTransport = HttpTransport.sseJson.with<OpenResponsesBody>()

export * as OpenResponses from "./open-responses.js"
