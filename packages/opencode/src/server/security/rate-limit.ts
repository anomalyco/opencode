import { rateLimiter } from "hono-rate-limiter"
import type { Context } from "hono"
import { Log } from "../../util/log"

const log = Log.create({ service: "rate-limit" })

/**
 * Rate limit configuration.
 */
export interface RateLimitConfig {
  windowMs?: number // default: 15 * 60 * 1000 (15 min)
  limit?: number // default: 5
}

/**
 * Extract client IP address from request headers.
 *
 * Checks X-Forwarded-For (takes first IP), falls back to X-Real-IP,
 * then returns 'unknown' if no headers present.
 */
export function getClientIP(c: Context): string {
  // Check X-Forwarded-For (comma-separated list, take first)
  const xForwardedFor = c.req.header("X-Forwarded-For")
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0].trim()
    if (firstIp) return firstIp
  }

  // Fall back to X-Real-IP
  const xRealIp = c.req.header("X-Real-IP")
  if (xRealIp) return xRealIp

  // Fall back to unknown
  return "unknown"
}

/**
 * Create a rate limiter for the login endpoint.
 *
 * Limits login attempts per IP address to prevent brute force attacks.
 * Returns 429 with Retry-After header when limit is exceeded.
 *
 * @param config - Rate limit configuration
 * @returns Rate limiter middleware
 */
export function createLoginRateLimiter(config?: RateLimitConfig) {
  const windowMs = config?.windowMs ?? 15 * 60 * 1000 // 15 minutes
  const limit = config?.limit ?? 5

  return rateLimiter({
    windowMs,
    limit,
    standardHeaders: "draft-7", // Return rate limit info in headers
    keyGenerator: (c) => getClientIP(c),
    handler: (c) => {
      const ip = getClientIP(c)
      const timestamp = new Date().toISOString()

      // Log security event
      log.warn("[SECURITY] Rate limit exceeded", {
        ip,
        timestamp,
        user_agent: c.req.header("User-Agent"),
      })

      // Set Retry-After header (in seconds)
      const retryAfterSeconds = Math.ceil(windowMs / 1000)
      c.header("Retry-After", retryAfterSeconds.toString())

      // Return 429 with error message
      return c.json(
        {
          error: "rate_limit_exceeded",
          message: "Too many login attempts. Please try again later.",
        },
        429,
      )
    },
  })
}
