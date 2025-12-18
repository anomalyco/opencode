/**
 * HTTP utility functions shared across auth and inference modules.
 */

/**
 * Default cooldown when auth has expired (5 minutes).
 */
export const AUTH_EXPIRED_COOLDOWN_MS = 5 * 60_000

/**
 * Default cooldown when rate limited and no Retry-After header (30 seconds).
 */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000

/**
 * Parse the Retry-After header from a response.
 * Supports:
 * - `Retry-After-Ms` header (milliseconds, non-standard but used by some providers)
 * - `Retry-After` header with seconds value
 * - `Retry-After` header with HTTP date
 *
 * @returns Cooldown in milliseconds, or undefined if not present/parseable
 */
export function parseRetryAfterMs(resp: Response): number | undefined {
    // Some providers use non-standard millisecond headers
    const msHeader = resp.headers.get("retry-after-ms") ?? resp.headers.get("Retry-After-Ms")
    if (msHeader) {
        const ms = Number(msHeader.trim())
        if (Number.isFinite(ms) && ms >= 0) return Math.floor(ms)
    }

    const raw = resp.headers.get("retry-after") ?? resp.headers.get("Retry-After")
    if (!raw) return undefined

    const trimmed = raw.trim()
    if (!trimmed) return undefined

    // Try parsing as seconds (most common)
    const seconds = Number(trimmed)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000)

    // Try parsing as HTTP date
    const date = Date.parse(trimmed)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())

    return undefined
}
