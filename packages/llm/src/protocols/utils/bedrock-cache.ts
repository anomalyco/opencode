import { Schema } from "effect"
import type { CacheHint } from "../../schema"
import { newBreakpoints, ttlBucket, type Breakpoints } from "./cache"

// Bedrock cache markers are positional: emit a `cachePoint` block immediately
// after the content the caller wants treated as a cacheable prefix. Bedrock
// accepts optional `ttl: "5m" | "1h"` on cachePoint, mirroring Anthropic.
export const CachePointBlock = Schema.Struct({
  cachePoint: Schema.Struct({
    type: Schema.tag("default"),
    ttl: Schema.optional(Schema.Literals(["5m", "1h"])),
  }),
})
export type CachePointBlock = Schema.Schema.Type<typeof CachePointBlock>

// Bedrock-Claude enforces the same 4-breakpoint cap as the Anthropic Messages
// API. Callers pass a shared counter through every `block()` call site so the
// budget is respected across `system`, `messages`, and `tools`.
export const BEDROCK_BREAKPOINT_CAP = 4

export type { Breakpoints } from "./cache"
export const breakpoints = () => newBreakpoints(BEDROCK_BREAKPOINT_CAP)

const DEFAULT_5M: CachePointBlock = { cachePoint: { type: "default" } }
const DEFAULT_1H: CachePointBlock = { cachePoint: { type: "default", ttl: "1h" } }

export const block = (breakpoints: Breakpoints, cache: CacheHint | undefined): CachePointBlock | undefined => {
  if (cache?.type !== "ephemeral" && cache?.type !== "persistent") return undefined
  if (breakpoints.remaining <= 0) {
    breakpoints.dropped += 1
    return undefined
  }
  breakpoints.remaining -= 1
  return ttlBucket(cache.ttlSeconds) === "1h" ? DEFAULT_1H : DEFAULT_5M
}

export * as BedrockCache from "./bedrock-cache"
