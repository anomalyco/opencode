// Shared counter and lifetime mapping for provider cache lowering.
import { Effect } from "effect"
import type { CacheHint, CacheTTL } from "../../schema/index.js"

export interface Breakpoints {
  remaining: number
  dropped: number
}

export const newBreakpoints = (cap: number): Breakpoints => ({ remaining: cap, dropped: 0 })

// Spends one breakpoint, or records it as dropped once the budget is gone.
export const take = (breakpoints: Breakpoints) => {
  if (breakpoints.remaining <= 0) {
    breakpoints.dropped += 1
    return false
  }
  breakpoints.remaining -= 1
  return true
}

export const warnDropped = (breakpoints: Breakpoints, protocol: string, cap: number) =>
  breakpoints.dropped === 0
    ? Effect.void
    : Effect.logWarning(
        `${protocol}: dropped ${breakpoints.dropped} cache breakpoint(s); the API allows at most ${cap} per request.`,
      )

export const cacheControl = () => {
  const breakpoints = newBreakpoints(4)
  return (cache: CacheHint | undefined) => {
    if (cache === undefined || !take(breakpoints)) return undefined
    return { type: "ephemeral" as const, ttl: cache.ttl }
  }
}

// OpenAI's request-level lifetime. `prompt_cache_retention` takes only "24h" (or "in_memory") and is the only
// control before GPT-5.6; every other lifetime goes to `prompt_cache_options.ttl`, which GPT-5.6+, Kimi and
// DeepInfra read.
export const openAIRequestTTL = (ttl: CacheTTL | undefined) => {
  if (ttl === undefined) return {}
  if (ttl === "24h") return { prompt_cache_retention: ttl }
  return { prompt_cache_options: { ttl } }
}
