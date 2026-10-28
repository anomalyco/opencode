import { Schema } from "effect"
import { CacheTTL, type CacheHint, type LLMRequest } from "../../schema/index.js"
import { newBreakpoints } from "./cache.js"

// Bedrock cache markers are positional: emit a `cachePoint` block immediately
// after the content the caller wants treated as a cacheable prefix. Bedrock
// accepts an optional `ttl` such as "5m" or "1h" on cachePoint.
export const CachePointBlock = Schema.Struct({
  cachePoint: Schema.Struct({
    type: Schema.tag("default"),
    ttl: Schema.optional(CacheTTL),
  }),
})
export type CachePointBlock = Schema.Schema.Type<typeof CachePointBlock>

const LEGACY_CLAUDE = ["anthropic.claude-instant", "anthropic.claude-v1", "anthropic.claude-v2", "anthropic.claude-3-"]

// These legacy Claude releases support explicit caching, but only for five minutes.
const CLAUDE_5M = [
  "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "anthropic.claude-3-5-haiku-20241022-v1:0",
  "anthropic.claude-3-7-sonnet-20250219-v1:0",
  "anthropic.claude-sonnet-4-20250514-v1:0",
  "anthropic.claude-opus-4-20250514-v1:0",
  "anthropic.claude-opus-4-1-20250805-v1:0",
]

// Callers share the four-breakpoint budget across system, messages, and tools.
export const BEDROCK_BREAKPOINT_CAP = 4

export const breakpoints = (model: LLMRequest["model"]) => {
  // Substring matching also handles regional prefixes and model-bearing ARNs.
  const short = CLAUDE_5M.some((id) => model.id.includes(id))
  return {
    ...newBreakpoints(BEDROCK_BREAKPOINT_CAP),
    // An explicit Anthropic cache format opts opaque IDs such as application inference profile ARNs in.
    // Assume modern Claude releases retain caching support; older generations need an explicit exception.
    // Other model families use implicit caching where available.
    supported:
      model.compatibility?.cacheFormat === "anthropic" ||
      (model.id.includes("anthropic.claude-") && (short || !LEGACY_CLAUDE.some((id) => model.id.includes(id)))),
    ttl1h: !short,
  }
}
export type Breakpoints = ReturnType<typeof breakpoints>

export const block = (breakpoints: Breakpoints, cache: CacheHint | undefined): CachePointBlock | undefined => {
  if (!breakpoints.supported) return undefined
  if (cache?.type !== "ephemeral" && cache?.type !== "persistent") return undefined
  if (breakpoints.remaining <= 0) {
    breakpoints.dropped += 1
    return undefined
  }
  breakpoints.remaining -= 1
  // Older Claude releases cache for five minutes only, so a one-hour request falls back to the default.
  const ttl = cache.ttl === "1h" && !breakpoints.ttl1h ? undefined : cache.ttl
  return { cachePoint: { type: "default", ...(ttl === undefined ? {} : { ttl }) } }
}

export * as BedrockCache from "./bedrock-cache.js"
