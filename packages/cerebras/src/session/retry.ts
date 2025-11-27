import { MessageV2 } from "./message-v2"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_ATTEMPTS = 5 // Maximum retry attempts per session
  export const RETRY_JITTER_FACTOR = 0.1 // 10% jitter to prevent thundering herd

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout)
          reject(new DOMException("Aborted", "AbortError"))
        },
        { once: true },
      )
    })
  }

  /**
   * Add jitter to delay to prevent thundering herd problem
   * Uses full jitter strategy: random value between 0 and calculated delay
   */
  function addJitter(delayMs: number): number {
    const jitter = delayMs * RETRY_JITTER_FACTOR
    return delayMs - jitter + Math.random() * 2 * jitter
  }

  /**
   * Check if error is a rate limit (429) error
   */
  export function isRateLimitError(error?: MessageV2.APIError): boolean {
    if (!error) return false
    return error.data.statusCode === 429
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * Respects Retry-After headers from the API
   */
  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        // Prefer retry-after-ms header (milliseconds)
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            // Add jitter even to header-based delays
            return Math.ceil(addJitter(parsedMs))
          }
        }

        // Fall back to retry-after header (seconds or HTTP date)
        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds
            const delayMs = parsedSeconds * 1000
            return Math.ceil(addJitter(delayMs))
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(addJitter(parsed))
          }
        }
      }

      // For 429 errors without retry-after, use aggressive backoff
      if (isRateLimitError(error)) {
        const baseDelay = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt)
        return Math.ceil(addJitter(Math.min(baseDelay, RETRY_MAX_DELAY_NO_HEADERS)))
      }
    }

    // Standard exponential backoff with jitter
    const baseDelay = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
    const cappedDelay = Math.min(baseDelay, RETRY_MAX_DELAY_NO_HEADERS)
    return Math.ceil(addJitter(cappedDelay))
  }
}
