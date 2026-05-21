export type RateLimiter = {
  check: () => Promise<void>
  track: () => Promise<void>
}

export type RateLimiterState = {
  isNew: boolean
  fallbackDatabase: boolean
}

export function getRetryAfterDay(now: number) {
  return Math.ceil((86_400_000 - (now % 86_400_000)) / 1000)
}
