import { Model, Patch, predicate } from "./patch"
import { CacheHint } from "./schema"
import type { ContentPart, JsonSchema, LLMRequest, Message, ToolDefinition } from "./schema"

const mimeToModality = (mime: string) => {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const sanitizeMoonshotSchema = (value: unknown): unknown => {
  if (!isRecord(value)) return Array.isArray(value) ? value.map(sanitizeMoonshotSchema) : value
  if (typeof value.$ref === "string") return { $ref: value.$ref }
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeMoonshotSchema(item)]))
  if (Array.isArray(result.items)) result.items = result.items[0] ?? {}
  return result
}

const removeEmptyParts = (content: ReadonlyArray<ContentPart>) =>
  content.filter((part) => (part.type === "text" || part.type === "reasoning" ? part.text !== "" : true))

const rewriteToolIds = (request: LLMRequest, scrub: (id: string) => string): LLMRequest => ({
  ...request,
  messages: request.messages.map((message) => {
    if (message.role !== "assistant" && message.role !== "tool") return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "tool-call" || part.type === "tool-result") return { ...part, id: scrub(part.id) }
        return part
      }),
    }
  }),
})

export const removeEmptyAnthropicContent = Patch.prompt("anthropic.remove-empty-content", {
  reason: "remove empty text/reasoning blocks for providers that reject empty content",
  when: Model.provider("anthropic").or(Model.provider("bedrock"), Model.provider("amazon-bedrock")),
  apply: (request) => ({
    ...request,
    system: request.system.filter((part) => part.text !== ""),
    messages: request.messages
      .map((message) => ({ ...message, content: removeEmptyParts(message.content) }))
      .filter((message) => message.content.length > 0),
  }),
})

export const scrubClaudeToolIds = Patch.prompt("anthropic.scrub-tool-call-ids", {
  reason: "Claude tool_use ids only accept alphanumeric, underscore, and dash characters",
  when: Model.idIncludes("claude"),
  apply: (request) => rewriteToolIds(request, (id) => id.replace(/[^a-zA-Z0-9_-]/g, "_")),
})

export const scrubMistralToolIds = Patch.prompt("mistral.scrub-tool-call-ids", {
  reason: "Mistral tool call ids must be short alphanumeric identifiers",
  when: Model.provider("mistral").or(Model.idIncludes("mistral"), Model.idIncludes("devstral")),
  apply: (request) => rewriteToolIds(request, (id) => id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 9).padEnd(9, "0")),
})

export const repairAnthropicToolUseOrder = Patch.prompt("anthropic.repair-tool-use-order", {
  reason: "Anthropic rejects assistant turns where tool_use blocks are followed by non-tool content",
  when: Model.provider("anthropic").or(Model.provider("google-vertex-anthropic"), Model.idIncludes("claude")),
  apply: (request) => ({
    ...request,
    messages: request.messages.flatMap((message): ReadonlyArray<Message> => {
      if (message.role !== "assistant") return [message]
      const firstToolCall = message.content.findIndex((part) => part.type === "tool-call")
      if (firstToolCall === -1) return [message]
      if (!message.content.slice(firstToolCall).some((part) => part.type !== "tool-call")) return [message]
      return [
        { ...message, content: message.content.filter((part) => part.type !== "tool-call") },
        { ...message, content: message.content.filter((part) => part.type === "tool-call") },
      ]
    }),
  }),
})

export const repairMistralToolResultUserSequence = Patch.prompt("mistral.repair-tool-user-sequence", {
  reason: "Mistral rejects tool messages followed immediately by user messages",
  when: Model.provider("mistral").or(Model.idIncludes("mistral"), Model.idIncludes("devstral")),
  apply: (request) => ({
    ...request,
    messages: request.messages.flatMap((message, index) =>
      message.role === "tool" && request.messages[index + 1]?.role === "user"
        ? [message, { role: "assistant" as const, content: [{ type: "text" as const, text: "Done." }] }]
        : [message],
    ),
  }),
})

export const addDeepSeekEmptyReasoning = Patch.prompt("deepseek.empty-reasoning-replay", {
  reason: "DeepSeek expects assistant history to carry reasoning_content, even when empty",
  when: Model.idIncludes("deepseek"),
  apply: (request) => ({
    ...request,
    messages: request.messages.map((message) => {
      if (message.role !== "assistant") return message
      if (message.content.some((part) => part.type === "reasoning")) return message
      return {
        ...message,
        native: {
          ...message.native,
          openaiCompatible: {
            ...(isRecord(message.native?.openaiCompatible) ? message.native.openaiCompatible : {}),
            reasoning_content: "",
          },
        },
      }
    }),
  }),
})

export const moveOpenAICompatibleReasoningToNative = Patch.prompt("openai-compatible.reasoning-native-field", {
  reason: "OpenAI-compatible reasoning providers replay reasoning in provider-native assistant fields",
  when: Model.adapter("openai-compatible-chat"),
  apply: (request) => ({
    ...request,
    messages: request.messages.map((message) => {
      if (message.role !== "assistant") return message
      const reasoning = message.content.filter((part) => part.type === "reasoning").map((part) => part.text).join("")
      if (reasoning === "") return message
      return {
        ...message,
        content: message.content.filter((part) => part.type !== "reasoning"),
        native: {
          ...message.native,
          openaiCompatible: {
            ...(isRecord(message.native?.openaiCompatible) ? message.native.openaiCompatible : {}),
            reasoning_content: reasoning,
          },
        },
      }
    }),
  }),
})

export const unsupportedMediaFallback = Patch.prompt("capabilities.unsupported-media-fallback", {
  reason: "turn unsupported user media into model-visible error text instead of provider request failures",
  apply: (request) => ({
    ...request,
    messages: request.messages.map((message) => {
      if (message.role !== "user") return message
      return {
        ...message,
        content: message.content.map((part): ContentPart => {
          if (part.type !== "media") return part
          const modality = mimeToModality(part.mediaType)
          if (!modality || request.model.capabilities.input[modality]) return part
          return {
            type: "text",
            text: `ERROR: Cannot read ${part.filename ? `"${part.filename}"` : modality} (this model does not support ${modality} input). Inform the user.`,
          }
        }),
      }
    }),
  }),
})

export const sanitizeMoonshotToolSchema = Patch.toolSchema("moonshot.schema", {
  reason: "Moonshot/Kimi rejects $ref sibling keywords and tuple-style array items",
  when: Model.provider("moonshotai").or(Model.idIncludes("kimi")),
  apply: (tool): ToolDefinition => ({
    ...tool,
    inputSchema: sanitizeMoonshotSchema(tool.inputSchema) as JsonSchema,
  }),
})

// Single shared CacheHint instance — the cache patch reuses this one object
// across every marked part. Adapters lower CacheHint structurally
// (`cache?.type === "ephemeral"`) so reference equality is incidental, but
// keeping a class instance preserves any consumer that checks
// `instanceof CacheHint`.
const EPHEMERAL_CACHE = new CacheHint({ type: "ephemeral" })

const withCacheOnLastText = (content: ReadonlyArray<ContentPart>): ReadonlyArray<ContentPart> => {
  const last = content.findLastIndex((part) => part.type === "text")
  if (last === -1) return content
  return content.map((part, index) =>
    index === last && part.type === "text" ? { ...part, cache: EPHEMERAL_CACHE } : part,
  )
}

// Anthropic and Bedrock both honor up to four positional cache breakpoints.
// We mark the first 2 system parts and the last 2 messages — the same policy
// OpenCode uses on the AI-SDK path (`session.applyCaching` in
// packages/opencode/src/provider/transform.ts). The capability gate makes
// this a no-op for adapters that don't advertise prompt-level caching, so
// non-cache providers (OpenAI Responses, Gemini, OpenAI-compatible Chat)
// are unaffected.
export const cachePromptHints = Patch.prompt("cache.prompt-hints", {
  reason: "mark first 2 system parts and last 2 messages with ephemeral cache hints on cache-capable adapters",
  when: predicate((context) => context.model.capabilities.cache?.prompt === true),
  apply: (request) => ({
    ...request,
    system: request.system.map((part, index) =>
      index < 2 ? { ...part, cache: EPHEMERAL_CACHE } : part,
    ),
    messages: request.messages.map((message, index) =>
      index < request.messages.length - 2
        ? message
        : { ...message, content: withCacheOnLastText(message.content) },
    ),
  }),
})

export const defaults = [
  unsupportedMediaFallback,
  removeEmptyAnthropicContent,
  scrubClaudeToolIds,
  scrubMistralToolIds,
  repairAnthropicToolUseOrder,
  repairMistralToolResultUserSequence,
  moveOpenAICompatibleReasoningToNative,
  addDeepSeekEmptyReasoning,
  sanitizeMoonshotToolSchema,
  cachePromptHints,
]

export * as ProviderPatch from "./provider-patch"
