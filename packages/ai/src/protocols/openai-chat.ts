import { Effect, Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { Route } from "../route/client.js"
import { Auth } from "../route/auth.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { HttpTransport } from "../route/transport/index.js"
import { Protocol } from "../route/protocol.js"
import {
  AIError,
  AIErrorReason,
  InvalidProviderOutputError,
  LLMEvent,
  ProviderInternalError,
  UnknownProviderError,
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
} from "../schema/index.js"
import { classifyProviderFailure } from "../provider-error.js"
import { isRecord, JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared.js"
import { OpenAIOptions } from "./utils/openai-options.js"
import { Lifecycle } from "./utils/lifecycle.js"
import { ToolSchemaProjection } from "./utils/tool-schema.js"
import { ToolStream } from "./utils/tool-stream.js"

const ADAPTER = "openai-chat"
const RESERVED_REASONING_FIELDS = new Set(["role", "content", "refusal", "tool_calls"])
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
  function: Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    parameters: JsonObject,
    strict: Schema.optional(Schema.Boolean),
  }),
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

// Intentionally omit Gemini's provider-specific `extra_content.google.thought_signature`
// extension until direct Google OpenAI-compatible routing is supported here:
// https://github.com/vercel/ai/issues/11590
// https://github.com/vercel/ai/pull/11745
// https://ai.google.dev/gemini-api/docs/thought-signatures#openai

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
  prompt_cache_key: Schema.optional(Schema.String),
  reasoning_effort: Schema.optional(OpenAIOptions.OpenAIReasoningEffort),
  tool_stream: Schema.optional(Schema.Boolean),
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
const OpenAIChatUsage = Schema.StructWithRest(
  Schema.Struct({
    prompt_tokens: optionalNull(Schema.Number),
    completion_tokens: optionalNull(Schema.Number),
    total_tokens: optionalNull(Schema.Number),
    // Zai reports cache hits as top-level `cached_tokens`; DeepSeek uses `prompt_cache_hit_tokens`.
    cached_tokens: optionalNull(Schema.Number),
    prompt_cache_hit_tokens: optionalNull(Schema.Number),
    prompt_tokens_details: optionalNull(
      Schema.StructWithRest(
        Schema.Struct({
          cached_tokens: optionalNull(Schema.Number),
          cache_write_tokens: optionalNull(Schema.Number),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
    completion_tokens_details: optionalNull(
      Schema.StructWithRest(
        Schema.Struct({
          reasoning_tokens: optionalNull(Schema.Number),
          accepted_prediction_tokens: optionalNull(Schema.Number),
          rejected_prediction_tokens: optionalNull(Schema.Number),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

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
    refusal: optionalNull(Schema.String),
    reasoning_content: optionalNull(Schema.String),
    reasoning: optionalNull(Schema.String),
    reasoning_text: optionalNull(Schema.String),
    reasoning_details: optionalNull(Schema.Unknown),
    tool_calls: optionalNull(Schema.Array(OpenAIChatToolCallDelta)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const OpenAIChatChoice = Schema.StructWithRest(
  Schema.Struct({
    delta: optionalNull(OpenAIChatDelta),
    finish_reason: optionalNull(Schema.String),
    native_finish_reason: optionalNull(Schema.String),
    // Moonshot streams usage on `choice.usage` instead of top-level `usage`.
    usage: optionalNull(OpenAIChatUsage),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const OpenAIChatError = Schema.StructWithRest(
  Schema.Struct({
    code: optionalNull(Schema.Union([Schema.String, Schema.Number])),
    message: Schema.String,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const OpenAIChatEvent = Schema.StructWithRest(
  Schema.Struct({
    choices: optionalNull(Schema.Array(OpenAIChatChoice)),
    usage: optionalNull(OpenAIChatUsage),
    error: optionalNull(OpenAIChatError),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export type OpenAIChatEvent = Schema.Schema.Type<typeof OpenAIChatEvent>
const DONE = "[DONE]" as const
const OpenAIChatStreamEvent = Schema.Union([Schema.Literal(DONE), Protocol.jsonEvent(OpenAIChatEvent)])
type OpenAIChatRequestMessage = LLMRequest["messages"][number]

interface PendingToolDelta {
  readonly id?: string
  readonly name?: string
  readonly input: string
}

export interface ParserState {
  readonly providerMetadataKey: string
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
  readonly latestToolIndex?: number
  readonly nextToolIndex: number
  readonly requireFinishReason: boolean
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
  readonly toolCallID?: (id: string) => string
}

const lowerTool = (
  tool: ToolDefinition,
  inputSchema: JsonSchema,
  options: LoweringOptions,
  supportsStrictMode: boolean,
): OpenAIChatTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: inputSchema,
    ...(supportsStrictMode ? { strict: false } : {}),
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

const lowerToolCall = (part: ToolCallPart, options: LoweringOptions): OpenAIChatAssistantToolCall => ({
  id: options.toolCallID?.(part.id) ?? part.id,
  type: "function",
  function: {
    name: part.name,
    arguments: ProviderShared.encodeJson(part.input),
  },
})

const lowerMedia = Effect.fn("OpenAIChat.lowerMedia")(function* (part: MediaPart) {
  const media = ProviderShared.normalizeMedia(part)
  if (!media.mime.startsWith("image/"))
    return yield* ProviderShared.invalidRequest(`OpenAI Chat does not support media type ${part.mediaType}`)
  return { type: "image_url" as const, image_url: { url: media.dataUrl } }
})

const openAICompatibleReasoningContent = (native: unknown) =>
  isRecord(native) && typeof native.reasoning_content === "string" ? native.reasoning_content : undefined

const reasoningField = (part: ReasoningPart, providerMetadataKey: string) => {
  const field = part.providerMetadata?.[providerMetadataKey]?.reasoningField
  return typeof field === "string" ? field : undefined
}

const reasoningDetails = (parts: ReadonlyArray<ReasoningPart>, native: unknown, providerMetadataKey: string) => {
  const observed = parts.flatMap((part) => {
    const details = part.providerMetadata?.[providerMetadataKey]?.reasoningDetails
    return Array.isArray(details) ? details : []
  })
  if (parts.some((part) => Array.isArray(part.providerMetadata?.[providerMetadataKey]?.reasoningDetails)))
    return observed
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
  configuredField: string | undefined,
  requireReasoning: boolean,
  options: LoweringOptions & { readonly providerMetadataKey: string },
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
      toolCalls.push(lowerToolCall(part, options))
      continue
    }
  }
  const text = reasoning.map((part) => part.text).join("")
  const details = reasoningDetails(reasoning, message.native?.openaiCompatible, options.providerMetadataKey)
  const observedField = reasoning
    .map((part) => reasoningField(part, options.providerMetadataKey))
    .find((value) => value !== undefined)
  const nativeReasoning = openAICompatibleReasoningContent(message.native?.openaiCompatible)
  const fullyStructured = reasoning.every((part) =>
    Array.isArray(part.providerMetadata?.[options.providerMetadataKey]?.reasoningDetails),
  )
  const field = (() => {
    if (configuredField !== undefined && (requireReasoning || reasoning.length > 0 || nativeReasoning !== undefined))
      return configuredField
    if (reasoning.length === 0) return requireReasoning ? "reasoning_content" : undefined
    if (observedField !== undefined) return observedField
    if (nativeReasoning !== undefined) return "reasoning_content"
    if (!fullyStructured || requireReasoning) return "reasoning_content"
  })()
  const reasoningText = (() => {
    if (configuredField !== undefined)
      return reasoning.length === 0 ? (nativeReasoning ?? (requireReasoning ? "" : undefined)) : text
    if (reasoning.length === 0) return nativeReasoning ?? (requireReasoning ? "" : undefined)
    return text
  })()
  const cached = message.content.findLast((part) => "cache" in part && part.cache !== undefined)
  const cacheControl = options.cacheControl?.(cached && "cache" in cached ? cached.cache : undefined)
  const result = {
    role: "assistant" as const,
    content: content.length > 0 ? content.map((part) => part.text).join("") : toolCalls.length > 0 ? null : "",
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(details !== undefined ? { reasoning_details: details } : {}),
    ...(cacheControl !== undefined ? { cache_control: cacheControl } : {}),
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
        tool_call_id: options.toolCallID?.(part.id) ?? part.id,
        content: ProviderShared.toolResultText(part),
        cache_control: options.cacheControl?.(part.cache),
      })
      continue
    }
    const content: ReadonlyArray<Tool.Content> = part.result.value
    const text = content.filter((item) => item.type === "text").map((item) => item.text)
    messages.push({
      role: "tool",
      tool_call_id: options.toolCallID?.(part.id) ?? part.id,
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
  reasoningField: string | undefined,
  requireReasoning: boolean,
  options: LoweringOptions & { readonly providerMetadataKey: string },
) {
  if (message.role === "user") return [yield* lowerUserMessage(message, options)]
  if (message.role === "assistant")
    return [yield* lowerAssistantMessage(message, reasoningField, requireReasoning, options)]
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
  const modelID = request.model.id.toLowerCase()
  const requireReasoning =
    request.model.compatibility?.requireReasoning ??
    (request.model.compatibility?.reasoningField !== undefined ||
      request.model.provider === "deepseek" ||
      request.model.route.endpoint.baseURL?.toLowerCase().includes("deepseek.com") ||
      modelID.includes("deepseek"))
  const reasoningField = request.model.compatibility?.reasoningField
  const mistral = ["mistral", "devstral", "codestral", "pixtral", "mixtral"].some((family) => modelID.includes(family))
  const lowering = {
    ...options,
    providerMetadataKey: request.model.route.providerMetadataKey ?? String(request.model.provider),
    toolCallID: (id: string) => {
      if (mistral)
        return id
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 9)
          .padEnd(9, "0")
      if (modelID.includes("claude")) return id.replace(/[^a-zA-Z0-9_-]/g, "_")
      if (request.model.provider === "openai" || request.model.provider === "azure" || modelID.startsWith("openai/"))
        return id.slice(0, 40)
      return id
    },
  }
  const requireAssistantAfterTool = request.model.compatibility?.requireAssistantAfterTool ?? mistral
  const bridgeTools = () => {
    if (requireAssistantAfterTool && messages.at(-1)?.role === "tool")
      messages.push({ role: "assistant", content: "Done." })
  }
  const pendingImages: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = []
  const flushImages = () => {
    if (pendingImages.length === 0) return
    bridgeTools()
    messages.push({ role: "user", content: pendingImages.splice(0) })
  }
  for (const message of request.messages) {
    if (message.role === "user") bridgeTools()
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
    if (
      message.role === "assistant" &&
      message.content.every((part) => part.type === "text" && part.text.trim() === "")
    )
      continue
    if (message.role === "tool") {
      const lowered = yield* lowerToolMessages(message, lowering)
      messages.push(...lowered.messages)
      pendingImages.push(...lowered.images)
      continue
    }
    flushImages()
    messages.push(...(yield* lowerMessage(message, reasoningField, requireReasoning, lowering)))
  }
  flushImages()
  return messages
})

// Anthropic via LiteLLM and Amazon Bedrock require `tools` to be present
// whenever the conversation history contains tool calls/results. Send an
// explicit empty array when we have history but no active tools.
const hasToolHistory = (messages: ReadonlyArray<LLMRequest["messages"][number]>) => {
  for (const message of messages) {
    if (message.role === "tool") return true
    if (message.role === "assistant" && message.content.some((part) => part.type === "tool-call")) return true
  }
  return false
}

// Derive `max_tokens` vs `max_completion_tokens` from provider/baseURL when
// explicit `compatibility.maxTokensField` is not set. Aligned with
// models.dev provider naming: DeepSeek, Moonshot AI, Together AI, ZAI
// (Zhipu + Coding Plan variants), Nvidia, Cerebras, Chutes, etc. still
// require `max_tokens`.
const detectMaxTokensField = (
  provider: string,
  baseURL: string | undefined,
): "max_tokens" | "max_completion_tokens" => {
  const p = provider.toLowerCase()
  const url = (baseURL ?? "").toLowerCase()
  if (
    p === "deepseek" ||
    url.includes("deepseek.com") ||
    p === "moonshotai" ||
    url.includes("api.moonshot.ai") ||
    p === "togetherai" ||
    url.includes("api.together.") ||
    p === "zai" ||
    p === "zai-coding-plan" ||
    p === "zhipuai" ||
    p === "zhipuai-coding-plan" ||
    url.includes("api.z.ai") ||
    url.includes("open.bigmodel.cn") ||
    p === "nvidia" ||
    url.includes("integrate.api.nvidia.com") ||
    p === "cerebras" ||
    url.includes("cerebras.ai") ||
    url.includes("llm.chutes.ai") ||
    p === "chutes" ||
    p === "cloudflare-ai-gateway" ||
    url.includes("gateway.ai.cloudflare.com") ||
    p === "cloudflare-workers-ai" ||
    url.includes("api.cloudflare.com")
  )
    return "max_tokens"
  return "max_completion_tokens"
}

const detectSupportsStore = (provider: string, baseURL: string | undefined): boolean => {
  const p = provider.toLowerCase()
  const url = (baseURL ?? "").toLowerCase()
  const isNvidia = p === "nvidia" || url.includes("integrate.api.nvidia.com")
  const isMoonshot = p === "moonshotai" || p === "moonshotai-cn" || url.includes("api.moonshot.")
  const isTogether = p === "togetherai" || p === "together" || url.includes("api.together.")
  const isZai =
    p === "zai" ||
    p === "zai-coding-plan" ||
    p === "zhipuai" ||
    p === "zhipuai-coding-plan" ||
    url.includes("api.z.ai") ||
    url.includes("open.bigmodel.cn")
  const isDeepSeek = p === "deepseek" || url.includes("deepseek.com")
  const isCerebras = p === "cerebras" || url.includes("cerebras.ai")
  const isXai = p === "xai" || url.includes("api.x.ai")
  const isChutes = p === "chutes" || url.includes("chutes.ai")
  const isCloudflareWorkersAI = p === "cloudflare-workers-ai" || url.includes("api.cloudflare.com")
  const isCloudflareAiGateway = p === "cloudflare-ai-gateway" || url.includes("gateway.ai.cloudflare.com")
  const isVercelAiGateway =
    p === "vercel-ai-gateway" || url.includes("ai-gateway.vercel.sh") || url.includes("vercel.sh")
  const isAntLing = p === "ant-ling" || url.includes("api.ant-ling.com")
  const isOpencode = p === "opencode" || url.includes("opencode.ai")
  const isNonStandard =
    isNvidia ||
    isCerebras ||
    isXai ||
    isTogether ||
    isChutes ||
    isDeepSeek ||
    isZai ||
    isMoonshot ||
    isOpencode ||
    isCloudflareWorkersAI ||
    isCloudflareAiGateway ||
    isVercelAiGateway ||
    isAntLing
  return !isNonStandard
}

const detectSupportsUsageInStreaming = (): boolean => true

const detectSupportsStrictMode = (provider: string, baseURL: string | undefined): boolean => {
  const p = provider.toLowerCase()
  const url = (baseURL ?? "").toLowerCase()
  const isMoonshot = p === "moonshotai" || p === "moonshotai-cn" || url.includes("api.moonshot.")
  const isTogether = p === "togetherai" || p === "together" || url.includes("api.together.")
  const isCloudflareAiGateway = p === "cloudflare-ai-gateway" || url.includes("gateway.ai.cloudflare.com")
  const isNvidia = p === "nvidia" || url.includes("integrate.api.nvidia.com")
  return !isMoonshot && !isTogether && !isCloudflareAiGateway && !isNvidia
}

const detectZaiToolStream = (provider: string, baseURL: string | undefined, modelID: string): boolean => {
  const p = provider.toLowerCase()
  const url = (baseURL ?? "").toLowerCase()
  const isZai =
    p === "zai" ||
    p === "zai-coding-plan" ||
    p === "zhipuai" ||
    p === "zhipuai-coding-plan" ||
    url.includes("api.z.ai") ||
    url.includes("open.bigmodel.cn")
  if (!isZai) return false
  const id = modelID.toLowerCase()
  if (id === "glm-4.5" || id === "glm-4.5-air" || id === "glm-4.5-flash" || id === "glm-4.5v") return false
  return true
}

const lowerOptions = (request: LLMRequest, supportsStore: boolean) => {
  const options = OpenAIOptions.resolve(request)
  const cacheKey = ProviderShared.promptCacheKey(request)
  return {
    ...(supportsStore && options.store !== undefined ? { store: options.store } : {}),
    // For providers that support `store`, ensure stateless `store:false` is sent
    // even when no explicit `providerOptions.store` was supplied, mirroring the
    // native OpenAI Chat default. Non-standard providers omit `store` entirely.
    ...(supportsStore && options.store === undefined ? { store: false } : {}),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
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
  const flattened = ProviderShared.flattenToolRequest(request)
  const provider = String(request.model.provider)
  const baseURL = request.model.route.endpoint.baseURL
  const detectedMaxTokensField = detectMaxTokensField(provider, baseURL)
  const maxTokensField = request.model.compatibility?.maxTokensField ?? detectedMaxTokensField
  const supportsStore = request.model.compatibility?.supportsStore ?? detectSupportsStore(provider, baseURL)
  const supportsUsageInStreaming =
    request.model.compatibility?.supportsUsageInStreaming ?? detectSupportsUsageInStreaming()
  const supportsStrictMode =
    request.model.compatibility?.supportsStrictMode ?? detectSupportsStrictMode(provider, baseURL)
  const zaiToolStream =
    request.model.compatibility?.zaiToolStream ?? detectZaiToolStream(provider, baseURL, request.model.id)
  const hasHistory = hasToolHistory(request.messages)
  const hasActiveTools = flattened.tools.length > 0
  return {
    model: request.model.id,
    messages: yield* lowerMessages(flattened.request, options),
    tools:
      flattened.tools.length === 0
        ? hasHistory
          ? []
          : undefined
        : flattened.tools.map((tool) =>
            lowerTool(
              tool,
              ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility),
              options,
              supportsStrictMode,
            ),
          ),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    ...(supportsUsageInStreaming ? { stream_options: { include_usage: true } } : {}),
    ...(zaiToolStream && hasActiveTools ? { tool_stream: true } : {}),
    ...(maxTokensField === "max_completion_tokens"
      ? { max_completion_tokens: generation?.maxTokens }
      : { max_tokens: generation?.maxTokens }),
    temperature: generation?.temperature,
    top_p: generation?.topP,
    frequency_penalty: generation?.frequencyPenalty,
    presence_penalty: generation?.presencePenalty,
    seed: generation?.seed,
    stop: generation?.stop,
    ...lowerOptions(request, supportsStore),
  }
})

// =============================================================================
// Stream Parsing
// =============================================================================
// Streaming parsers are small state machines: every event returns a new state
// plus the common `LLMEvent`s produced by that event. Tool calls are accumulated
// because OpenAI streams JSON arguments across multiple deltas.
const mapFinishReason = Effect.fn("OpenAIChat.mapFinishReason")(function* (event: OpenAIChatEvent, reason: string) {
  switch (reason) {
    case "error":
      return yield* new AIError({
        reason: new UnknownProviderError({
          message: "Provider reported an error (finish_reason: error)",
          body: ProviderShared.encodeJson(event),
        }),
      })
    case "network_error":
      return yield* new AIError({
        reason: new ProviderInternalError({
          message: "Provider reported a network error (finish_reason: network_error)",
          body: ProviderShared.encodeJson(event),
        }),
      })
    case "stop":
    case "end":
      return "stop" as const
    case "length":
      return "length" as const
    case "content_filter":
      return "content-filter" as const
    case "function_call":
    case "tool_calls":
      return "tool-calls" as const
    default:
      return yield* new AIError({
        reason: new UnknownProviderError({
          message: `Provider finish_reason: ${reason}`,
          body: ProviderShared.encodeJson(event),
        }),
      })
  }
})

// OpenAI Chat reports `prompt_tokens` (inclusive total) with a
// cached-read and cache-write subsets, and `completion_tokens` (inclusive
// total) with a `reasoning_tokens` subset. We pass the inclusive totals
// through and derive the non-cached breakdown so the `AI.Usage` contract is
// satisfied on both sides.
// Providers differ on cache-hit location: OpenAI uses
// `prompt_tokens_details.cached_tokens`, DeepSeek uses
// `prompt_cache_hit_tokens`, and Zai uses top-level `cached_tokens`.
const mapUsage = (usage: OpenAIChatEvent["usage"], providerMetadataKey: string): Usage | undefined => {
  if (!usage) return undefined
  const input = usage.prompt_tokens ?? undefined
  const output = usage.completion_tokens ?? undefined
  const cached = (usage.prompt_tokens_details?.cached_tokens ??
    (usage as { prompt_cache_hit_tokens?: number | null }).prompt_cache_hit_tokens ??
    (usage as { cached_tokens?: number | null }).cached_tokens ??
    undefined) as number | undefined
  const cacheWrite = usage.prompt_tokens_details?.cache_write_tokens ?? undefined
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? undefined
  const nonCached = ProviderShared.subtractTokens(input, ProviderShared.sumTokens(cached, cacheWrite))
  return new Usage({
    inputTokens: input,
    outputTokens: output,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    reasoningTokens: reasoning,
    totalTokens: ProviderShared.totalTokens(input, output, usage.total_tokens ?? undefined),
    providerMetadata: { [providerMetadataKey]: usage },
  })
}

const toolIndexByID = (
  tools: ParserState["tools"],
  pendingTools: ParserState["pendingTools"],
  id: string | undefined,
) => {
  if (!id) return undefined
  const entry = Object.entries({ ...pendingTools, ...tools }).find(([, tool]) => tool?.id === id)
  return entry ? Number(entry[0]) : undefined
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

const reasoningMetadata = (
  providerMetadataKey: string,
  field: ParserState["reasoningField"],
  details?: ReadonlyArray<unknown>,
) => ({
  [providerMetadataKey]: {
    ...(field ? { reasoningField: field } : {}),
    ...(details ? { reasoningDetails: details } : {}),
  },
})

const step = (state: ParserState, event: OpenAIChatEvent) =>
  Effect.gen(function* () {
    if (event.error) {
      const body = ProviderShared.encodeJson(event)
      return yield* new AIError({
        reason: classifyProviderFailure({
          message: event.error.message,
          status: typeof event.error.code === "number" ? event.error.code : undefined,
          rawBody: body,
        }),
      })
    }
    const events: LLMEvent[] = []
    const choice = event.choices?.[0]
    // Moonshot (and a few other OpenAI-compatible providers) attach usage to
    // `choice.usage` instead of the top-level `usage` field.
    const choiceUsage = (choice as unknown as { usage?: OpenAIChatEvent["usage"] })?.usage
    const usage =
      mapUsage(event.usage, state.providerMetadataKey) ??
      (choiceUsage ? mapUsage(choiceUsage, state.providerMetadataKey) : undefined) ??
      state.usage
    const rawFinishReason = choice?.finish_reason
    const finishReason = rawFinishReason
      ? {
          normalized: yield* mapFinishReason(event, rawFinishReason),
          raw: choice?.native_finish_reason ?? rawFinishReason,
        }
      : state.finishReason
    const delta = choice?.delta
    const toolDeltas = delta?.tool_calls ?? []
    let tools = state.tools
    let pendingTools = state.pendingTools
    let latestToolIndex = state.latestToolIndex
    let nextToolIndex = state.nextToolIndex

    let lifecycle = state.lifecycle

    const reasoning = reasoningDelta(delta, state.reasoningField)
    const hasLateContent =
      Boolean(delta?.content) ||
      Boolean(delta?.refusal) ||
      reasoning !== undefined ||
      (Array.isArray(delta?.reasoning_details) && delta.reasoning_details.length > 0) ||
      toolDeltas.some((tool) => Boolean(tool.id) || Boolean(tool.function?.name) || Boolean(tool.function?.arguments))
    if (state.finishReason !== undefined) {
      if (hasLateContent)
        return yield* ProviderShared.eventError(
          ADAPTER,
          "OpenAI Chat received content after the finish reason",
          ProviderShared.encodeJson(event),
        )
      return [{ ...state, usage }, events] as const
    }

    const reasoningField = state.reasoningField ?? reasoning?.field
    const detailDelta = Array.isArray(delta?.reasoning_details) ? delta.reasoning_details : undefined
    if (detailDelta !== undefined) appendReasoningDetails(state.reasoningDetails, detailDelta)
    const reasoningDetailsObserved = state.reasoningDetailsObserved || detailDelta !== undefined
    const deltaMetadata = reasoningMetadata(state.providerMetadataKey, reasoningField)
    const text = detailDelta?.length ? (detailText(detailDelta) ?? reasoning?.text) : reasoning?.text
    if (text !== undefined) lifecycle = Lifecycle.reasoningDelta(lifecycle, events, "reasoning-0", text, deltaMetadata)
    else if (
      reasoningDetailsObserved &&
      !lifecycle.reasoning.has("reasoning-0") &&
      (Boolean(delta?.content) || Boolean(delta?.refusal) || toolDeltas.length > 0)
    )
      lifecycle = Lifecycle.reasoningStart(lifecycle, events, "reasoning-0", deltaMetadata)
    const reasoningEmitted = state.reasoningEmitted || lifecycle.reasoning.has("reasoning-0")

    // Reasoning is one response-wide channel: it stays open alongside text and
    // refusal output so late reasoning deltas and details join the same block,
    // and `finishEvents` closes it once with the complete metadata.
    if (delta?.content) lifecycle = Lifecycle.textDelta(lifecycle, events, "text-0", delta.content)

    if (delta?.refusal) lifecycle = Lifecycle.textDelta(lifecycle, events, "text-0", delta.refusal)

    // Compatible providers may omit indexes. Prefer durable identity, then use
    // batch position for parallel deltas or the latest call for sparse chunks.
    for (const [position, tool] of toolDeltas.entries()) {
      const matched = toolIndexByID(tools, pendingTools, tool.id || undefined)
      const fallback = toolDeltas.length > 1 ? position : (latestToolIndex ?? position)
      const fallbackTool = tools[fallback] ?? pendingTools[fallback]
      const index =
        tool.index ?? matched ?? (tool.id && fallbackTool?.id && fallbackTool.id !== tool.id ? nextToolIndex : fallback)
      const current = tools[index]
      const pending = pendingTools[index]
      const id = current?.id ?? pending?.id ?? (tool.id || undefined)
      const name = current?.name ?? pending?.name ?? (tool.function?.name || undefined)
      const text = `${pending?.input ?? ""}${tool.function?.arguments ?? ""}`
      latestToolIndex = index
      nextToolIndex = Math.max(nextToolIndex, index + 1)
      if (!current && (!id || !name)) {
        pendingTools = {
          ...pendingTools,
          [index]: { id: id || undefined, name: name || undefined, input: text },
        }
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
      if (ToolStream.isError(result))
        return yield* new AIError({
          reason: AIErrorReason.make({
            ...result.reason,
            message: result.message,
            cause: result.reason.cause,
            body: ProviderShared.encodeJson(event),
          }),
        })
      tools = result.tools
      if (result.events.length) lifecycle = Lifecycle.stepStart(lifecycle, events)
      events.push(...result.events)
    }

    const incompleteTools = finishReason?.normalized === "content-filter" || finishReason?.normalized === "length"
    if (
      finishReason !== undefined &&
      !incompleteTools &&
      state.finishReason === undefined &&
      Object.keys(pendingTools).length
    )
      return yield* ProviderShared.eventError(
        ADAPTER,
        "OpenAI Chat tool call delta is missing id or name",
        ProviderShared.encodeJson(event),
      )

    // Filtering or truncation terminates the response without confirming pending tool calls.
    const finished =
      finishReason !== undefined &&
      !incompleteTools &&
      state.finishReason === undefined &&
      Object.keys(tools).length > 0
        ? yield* ToolStream.finishAll(ADAPTER, tools)
        : undefined

    return [
      {
        providerMetadataKey: state.providerMetadataKey,
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
        latestToolIndex,
        nextToolIndex,
        requireFinishReason: state.requireFinishReason,
      },
      events,
    ] as const
  })

const finishEvents = Effect.fn("OpenAIChat.finishEvents")(function* (state: ParserState) {
  if (state.finishReason === undefined && state.requireFinishReason)
    return yield* new AIError({
      reason: new InvalidProviderOutputError({
        message: "OpenAI Chat stream ended without finish_reason",
        classification: "incomplete-stream",
        route: ADAPTER,
      }),
    })
  const events: LLMEvent[] = []
  const toolCallEvents =
    state.finishReason === undefined && Object.keys(state.tools).length > 0
      ? (yield* ToolStream.finishAll(ADAPTER, state.tools)).events
      : state.toolCallEvents
  const hasToolCalls = toolCallEvents.length > 0
  const reason = state.finishReason
    ? {
        ...state.finishReason,
        normalized:
          state.finishReason.normalized === "stop" && hasToolCalls ? "tool-calls" : state.finishReason.normalized,
      }
    : { normalized: hasToolCalls ? ("tool-calls" as const) : ("stop" as const) }
  // Snapshot details at publish time so the emitted event never observes later
  // mutation of the accumulated `reasoningDetails` array.
  const metadata = reasoningMetadata(
    state.providerMetadataKey,
    state.reasoningField,
    state.reasoningDetailsObserved ? [...state.reasoningDetails] : undefined,
  )
  const started =
    state.reasoningDetailsObserved && !state.reasoningEmitted
      ? Lifecycle.reasoningStart(
          state.lifecycle,
          events,
          "reasoning-0",
          reasoningMetadata(state.providerMetadataKey, state.reasoningField),
        )
      : state.lifecycle
  const ended = Lifecycle.reasoningEnd(started, events, "reasoning-0", metadata)
  const lifecycle = toolCallEvents.length ? Lifecycle.stepStart(ended, events) : ended
  events.push(...toolCallEvents)
  Lifecycle.finish(lifecycle, events, { reason, usage: state.usage })
  return events
})

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
    event: OpenAIChatStreamEvent,
    initial: (request) => ({
      providerMetadataKey: request.model.route.providerMetadataKey ?? String(request.model.provider),
      tools: ToolStream.empty<number>(),
      pendingTools: {},
      toolCallEvents: [],
      lifecycle: Lifecycle.initial(),
      reasoningField: request.model.compatibility?.reasoningField,
      reasoningDetails: [],
      reasoningDetailsObserved: false,
      reasoningEmitted: false,
      nextToolIndex: 0,
      requireFinishReason: request.model.compatibility?.requireFinishReason ?? true,
    }),
    step: (state: ParserState, event) => (event === DONE ? Effect.succeed([state, []] as const) : step(state, event)),
    terminal: (event) => event === DONE,
    onHalt: finishEvents,
  },
})

export const framing = Framing.sseWithDone
export const httpTransport = HttpTransport.sseJson.with<OpenAIChatBody>().with({ framing })

export const route = Route.make({
  id: ADAPTER,
  provider: "openai",
  providerMetadataKey: "openai",
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  transport: httpTransport,
})

export * as OpenAIChat from "./openai-chat.js"
