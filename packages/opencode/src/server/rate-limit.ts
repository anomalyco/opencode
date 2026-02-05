import type { Context, Next } from "hono"

interface RateLimitState {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitState>()

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, state] of store) {
    if (state.resetAt < now) store.delete(key)
  }
}, 60_000)

export function rateLimit(
  opts: {
    windowMs?: number
    max?: number
    keyGenerator?: (c: Context) => string
  } = {},
) {
  const { windowMs = 60_000, max = 100, keyGenerator } = opts

  return async (c: Context, next: Next) => {
    const key = keyGenerator
      ? keyGenerator(c)
      : (c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown")

    const now = Date.now()
    let state = store.get(key)

    if (!state || state.resetAt < now) {
      state = { count: 0, resetAt: now + windowMs }
      store.set(key, state)
    }

    state.count++

    c.header("X-RateLimit-Limit", String(max))
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - state.count)))
    c.header("X-RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)))

    if (state.count > max) {
      return c.text("Too Many Requests", 429)
    }

    return next()
  }
}
