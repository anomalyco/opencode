import type { HttpRateLimitDetails } from "./schema"

const cache = new Map<string, HttpRateLimitDetails>()

export const rateLimitCache = {
  set(providerId: string, details: HttpRateLimitDetails) {
    cache.set(providerId, details)
  },
  get(providerId: string) {
    return cache.get(providerId)
  },
  all(): ReadonlyMap<string, HttpRateLimitDetails> {
    return cache
  },
}
