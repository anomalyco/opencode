import { MessageV2 } from "./message-v2"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2

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

  export function getRetryDelayInMs(error: MessageV2.APIError, attempt: number): number {
    const base = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
    const headers = error.data.responseHeaders
    if (!headers) return base

    const retryAfterMs = headers["retry-after-ms"]
    if (retryAfterMs) {
      const parsed = Number.parseFloat(retryAfterMs)
      const normalized = normalizeDelay({ base, candidate: parsed })
      if (normalized != null) return normalized
    }

    const retryAfter = headers["retry-after"]
    if (!retryAfter) return base

    const seconds = Number.parseFloat(retryAfter)
    if (!Number.isNaN(seconds)) {
      const normalized = normalizeDelay({ base, candidate: seconds * 1000 })
      if (normalized != null) return normalized
      return base
    }

    const dateMs = Date.parse(retryAfter) - Date.now()
    const normalized = normalizeDelay({ base, candidate: dateMs })
    if (normalized != null) return normalized

    return base
  }

  function normalizeDelay(input: { base: number; candidate: number }): number | undefined {
    if (Number.isNaN(input.candidate)) return undefined
    if (input.candidate < 0) return undefined
    if (input.candidate < 60_000) return input.candidate
    if (input.candidate < input.base) return input.candidate
    return undefined
  }
}
