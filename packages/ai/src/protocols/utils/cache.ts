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

const UNITS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

// An omitted ttl is the provider default, five minutes on Anthropic.
const lifetime = (ttl: string | undefined) => {
  const match = ttl?.match(/^(\d+)(ms|s|m|h|d)$/)
  return match ? Number(match[1]) * UNITS[match[2] as keyof typeof UNITS] : UNITS.m * 5
}

// Anthropic reads cache markers in the order tools, system, messages and rejects a longer lifetime after a shorter
// one, such as a 1h marker after a 5m one. Raising each marker to the longest lifetime after it keeps the request
// valid at no cost: the prefix up to the last 1h marker is written for an hour either way. Pass the markers of a
// finished body in the order they are sent; they are updated in place.
export const orderLifetimes = (markers: ReadonlyArray<{ ttl?: string }>) =>
  markers.forEach((marker, index) => {
    const longest = markers
      .slice(index + 1)
      .reduce((ttl, later) => (lifetime(later.ttl) > lifetime(ttl) ? later.ttl : ttl), marker.ttl)
    if (longest !== marker.ttl) marker.ttl = longest
  })

// OpenAI's request-level lifetime. `prompt_cache_retention` takes only "24h" (or "in_memory") and is the only
// control before GPT-5.6; every other lifetime goes to `prompt_cache_options.ttl`, which GPT-5.6+, Kimi and
// DeepInfra read.
export const openAIRequestTTL = (ttl: CacheTTL | undefined) => {
  if (ttl === undefined) return {}
  if (ttl === "24h") return { prompt_cache_retention: ttl }
  return { prompt_cache_options: { ttl } }
}
