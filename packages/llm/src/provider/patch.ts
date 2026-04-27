import { Model, Patch, predicate } from "../patch"
import { CacheHint } from "../schema"
import type { ContentPart, LLMRequest } from "../schema"

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
  removeEmptyAnthropicContent,
  scrubClaudeToolIds,
  scrubMistralToolIds,
  cachePromptHints,
]

export * as ProviderPatch from "./patch"
