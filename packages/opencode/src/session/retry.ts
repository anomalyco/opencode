import type { NamedError } from "@opencode-ai/util/error"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout
  const VALUES_MAX_DEPTH = 32

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
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

        return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
      }
    }

    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  function parse(input: unknown) {
    if (typeof input !== "string") return undefined
    try {
      const result = JSON.parse(input)
      if (result && typeof result === "object") return result
      return undefined
    } catch {
      return undefined
    }
  }

  function values(input: unknown, seen = new WeakSet<object>(), depth = 0): string[] {
    if (input === undefined || input === null) return []
    if (typeof input === "string" || typeof input === "number") return [String(input).toLowerCase()]
    if (typeof input !== "object") return []
    if (depth >= VALUES_MAX_DEPTH || seen.has(input)) return []
    seen.add(input)
    if (Array.isArray(input)) return input.flatMap((value) => values(value, seen, depth + 1))
    return Object.values(input).flatMap((value) => values(value, seen, depth + 1))
  }

  function transient(input: unknown) {
    const all = values(input)
    if (
      all.some(
        (value) =>
          value.includes("context_length") ||
          value.includes("context window") ||
          value.includes("insufficient_quota") ||
          value.includes("usage_not_included") ||
          value.includes("invalid_prompt"),
      )
    )
      return undefined
    if (all.some((value) => value.includes("too_many_requests"))) return "Too Many Requests"
    if (all.some((value) => value === "429" || value.includes("rate_limit")))
      return "Rate Limited"
    if (
      all.some(
        (value) =>
          value === "502" ||
          value === "503" ||
          value === "504" ||
          value.includes("gateway timeout") ||
          value.includes("upstream timeout") ||
          value.includes("unavailable") ||
          value.includes("overloaded") ||
          value.includes("exhausted"),
      )
    )
      return "Provider is overloaded"
    return undefined
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    // context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      // This only classifies retryability; delay() applies Retry-After headers for API errors.
      const retry =
        transient({
          statusCode: error.data.statusCode,
          message: error.data.message,
          body: parse(error.data.responseBody),
          metadata: error.data.metadata,
        }) ?? (error.data.isRetryable ? error.data.message : undefined)
      if (!retry) return undefined
      if (error.data.responseBody?.includes("FreeUsageLimitError"))
        return `Free usage exceeded, add credits https://opencode.ai/zen`
      return retry.includes("Overloaded") ? "Provider is overloaded" : retry
    }

    const json = iife(() => {
      try {
        if (typeof error.data?.message === "string") {
          const parsed = JSON.parse(error.data.message)
          return parsed
        }

        return JSON.parse(error.data.message)
      } catch {
        return undefined
      }
    })
    try {
      if (!json || typeof json !== "object") return undefined
      const retry = transient(json)
      if (retry) return retry

      if (json.type === "error" && json.error?.type === "too_many_requests") {
        return "Too Many Requests"
      }
      if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
        return "Rate Limited"
      }
      return JSON.stringify(json)
    } catch {
      return undefined
    }
  }
}
