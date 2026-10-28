// Shared counter and lifetime mapping for provider cache lowering.
import type { CacheHint, CacheTTL } from "../../schema/index.js"

export interface Breakpoints {
  remaining: number
  dropped: number
}

export const newBreakpoints = (cap: number): Breakpoints => ({ remaining: cap, dropped: 0 })

export const cacheControl = () => {
  const breakpoints = newBreakpoints(4)
  return (cache: CacheHint | undefined) => {
    if (cache === undefined || breakpoints.remaining === 0) return undefined
    breakpoints.remaining -= 1
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
