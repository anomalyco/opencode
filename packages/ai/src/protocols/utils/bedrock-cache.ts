import { Schema } from "effect"
import type { CacheHint } from "../../schema/index.js"
import { newBreakpoints, ttlBucket } from "./cache.js"

// Bedrock cache markers are positional: emit a `cachePoint` block immediately
// after the content the caller wants treated as a cacheable prefix. Bedrock
// accepts optional `ttl: "5m" | "1h"` on cachePoint.
export const CachePointBlock = Schema.Struct({
  cachePoint: Schema.Struct({
    type: Schema.tag("default"),
    ttl: Schema.optional(Schema.Literals(["5m", "1h"])),
  }),
})
export type CachePointBlock = Schema.Schema.Type<typeof CachePointBlock>

// Converse cache support is model-specific, including the allowed fields and TTL.
// Bedrock's model cards also list older Claude models and Nova's system/messages-only support.
const CLAUDE_5M = new Set([
  "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "anthropic.claude-3-5-haiku-20241022-v1:0",
  "anthropic.claude-3-7-sonnet-20250219-v1:0",
  "anthropic.claude-sonnet-4-20250514-v1:0",
  "anthropic.claude-opus-4-20250514-v1:0",
  "anthropic.claude-opus-4-1-20250805-v1:0",
])
const CLAUDE_1H = new Set([
  "anthropic.claude-haiku-4-5-20251001-v1:0",
  "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "anthropic.claude-sonnet-4-6",
  "anthropic.claude-sonnet-5",
  "anthropic.claude-opus-4-5-20251101-v1:0",
  "anthropic.claude-opus-4-6-v1",
  "anthropic.claude-opus-4-7",
  "anthropic.claude-opus-4-8",
  "anthropic.claude-opus-5",
  "anthropic.claude-mythos-preview",
  "anthropic.claude-mythos-5",
  "anthropic.claude-mythos-5-1",
  "anthropic.claude-fable-5",
  "anthropic.claude-fable-5-1",
])
const NOVA = new Set([
  "amazon.nova-micro-v1:0",
  "amazon.nova-lite-v1:0",
  "amazon.nova-pro-v1:0",
  "amazon.nova-premier-v1:0",
  "amazon.nova-2-lite-v1:0",
])

// Callers share the four-breakpoint budget across system, messages, and tools.
export const BEDROCK_BREAKPOINT_CAP = 4

export const breakpoints = (modelID: string) => {
  // Foundation-model and system inference-profile ARNs carry the model ID.
  // Opaque application profiles cannot establish explicit caching support.
  const id = modelID
    .replace(/^arn:[^:]+:bedrock:[^:]*:[^:]*:(?:foundation-model|inference-profile)\//, "")
    .replace(/^(?:[a-z]{2}|apac|global)\./, "")
  const claude = CLAUDE_5M.has(id) || CLAUDE_1H.has(id)
  return {
    ...newBreakpoints(BEDROCK_BREAKPOINT_CAP),
    supported: claude || NOVA.has(id),
    tools: claude,
    ttl1h: CLAUDE_1H.has(id),
  }
}
export type Breakpoints = ReturnType<typeof breakpoints>

const DEFAULT_5M: CachePointBlock = { cachePoint: { type: "default" } }
const DEFAULT_1H: CachePointBlock = { cachePoint: { type: "default", ttl: "1h" } }

export const block = (
  breakpoints: Breakpoints,
  cache: CacheHint | undefined,
  section: "tools" | "content" = "content",
): CachePointBlock | undefined => {
  if (!breakpoints.supported || (section === "tools" && !breakpoints.tools)) return undefined
  if (cache?.type !== "ephemeral" && cache?.type !== "persistent") return undefined
  if (breakpoints.remaining <= 0) {
    breakpoints.dropped += 1
    return undefined
  }
  breakpoints.remaining -= 1
  return breakpoints.ttl1h && ttlBucket(cache.ttlSeconds) === "1h" ? DEFAULT_1H : DEFAULT_5M
}

export * as BedrockCache from "./bedrock-cache.js"
