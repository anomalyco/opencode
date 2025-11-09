import { iife } from "@/util/iife"
import { MessageV2 } from "./message-v2"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY = 600_000 // 10 minutes
  export const RETRY_HEADER_BUFFER = 1000 // add 1s buffer to server-provided delays

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

  export function getRetryDelayInMs(error: MessageV2.APIError, attempt: number) {
    const delay = iife(() => {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds
            return Math.ceil(parsedSeconds * 1000)
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }
      }

      return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
    })

    // dont retry if wait is too far from now
    if (delay > RETRY_MAX_DELAY) return undefined

    return delay
  }

  export function getBoundedDelay(input: {
    error: MessageV2.APIError
    attempt: number
    startTime: number
    maxDuration?: number
  }) {
    const elapsed = Date.now() - input.startTime
    const maxDuration = input.maxDuration ?? RETRY_MAX_DELAY
    const remaining = maxDuration - elapsed

    if (remaining <= 0) return undefined

    const delay = getRetryDelayInMs(input.error, input.attempt)
    if (!delay) return undefined

    return Math.min(delay, remaining)
  }
}
