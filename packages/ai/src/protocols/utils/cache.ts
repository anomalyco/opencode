// Shared counter and TTL mapping for provider cache-marker lowering.

export interface Breakpoints {
  remaining: number
  dropped: number
}

export const newBreakpoints = (cap: number): Breakpoints => ({ remaining: cap, dropped: 0 })

// Requests of at least one hour use the explicit `"1h"` bucket; shorter
// requests omit the wire TTL and use the provider default.
export const ttlBucket = (ttlSeconds: number | undefined): "1h" | undefined =>
  ttlSeconds !== undefined && ttlSeconds >= 3600 ? "1h" : undefined
