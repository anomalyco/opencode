/**
 * In-process token bucket rate limiter (ADR-0008).
 *
 * Single replica → single process → in-memory state is fine.  Loses
 * state on restart, which is acceptable for these thresholds and
 * spares us a Redis dependency.  If/when we go multi-replica per
 * ADR-0009, swap this for a Redis-backed bucket.
 *
 * Keys are caller-chosen strings (typically `route:<github_id>` for
 * authenticated callers or `route:<ip>` for anonymous).  The
 * `:` separator is convention — the helper doesn't care.
 *
 * One global Map; entries are evicted lazily when their bucket has
 * fully refilled and we haven't been called in 10 × window.  Avoids
 * pathological growth from one-off keys.
 */

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  /** Seconds the caller should wait before retrying — only meaningful when ok === false. */
  retryAfter: number
}

/**
 * Attempt to consume one token from `key`'s bucket.
 *
 *   - `limit`   — bucket capacity (max burst); refilled at `limit / windowMs` per ms
 *   - `windowMs` — the time window in milliseconds over which `limit` tokens are granted
 *
 * Example:
 *   checkRateLimit(`prompt:${userId}`, 60, 60_000)  // 60 per minute
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { tokens: limit - 1, lastRefill: now }
    buckets.set(key, bucket)
    return { ok: true, retryAfter: 0 }
  }
  // Refill proportionally to elapsed time.
  const elapsed = now - bucket.lastRefill
  bucket.tokens = Math.min(limit, bucket.tokens + (elapsed * limit) / windowMs)
  bucket.lastRefill = now
  if (bucket.tokens < 1) {
    // How long until one full token regenerates?
    const tokensMissing = 1 - bucket.tokens
    const ms = Math.ceil((tokensMissing * windowMs) / limit)
    return { ok: false, retryAfter: Math.ceil(ms / 1000) }
  }
  bucket.tokens -= 1
  return { ok: true, retryAfter: 0 }
}

/**
 * Coarse periodic sweep — drops bucket entries that have been idle for
 * 10× their last refill window.  Called lazily; not on a timer.
 */
export function sweepIdleBuckets(maxIdleMs: number = 60 * 60 * 1000): void {
  const cutoff = Date.now() - maxIdleMs
  for (const [k, b] of buckets) {
    if (b.lastRefill < cutoff) buckets.delete(k)
  }
}

/** Best-effort caller IP from common reverse-proxy headers.  Anonymous
 *  rate-limiting fallback when we don't have a github_id yet (e.g.
 *  OAuth callback). */
export function callerIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

/** Build a JSON 429 response with Retry-After.  Caller can `return` directly. */
export function rateLimitedResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests", retry_after: retryAfter }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfter),
      },
    },
  )
}
