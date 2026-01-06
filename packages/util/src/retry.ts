export interface RetryOptions {
  attempts?: number
  delay?: number
  factor?: number
  maxDelay?: number
  retryIf?: (error: unknown) => boolean
}

const TRANSIENT_MESSAGES = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
]

const RATE_LIMIT_MESSAGES = ["429", "rate limit", "too many requests"]

const SERVER_ERROR_MESSAGES = [
  "500",
  "502",
  "503",
  "504",
  "internal server error",
  "bad gateway",
  "service unavailable",
]

/**
 * Check if an error is a transient network error
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return TRANSIENT_MESSAGES.some((m) => message.includes(m))
}

/**
 * Check if an error is a rate limit error (HTTP 429)
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return RATE_LIMIT_MESSAGES.some((m) => message.includes(m))
}

/**
 * Check if an error is a server error (HTTP 5xx)
 */
export function isServerError(error: unknown): boolean {
  if (!error) return false
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return SERVER_ERROR_MESSAGES.some((m) => message.includes(m))
}

/**
 * Check if an error is retryable (network issues, rate limits, or server errors)
 * Use this for HTTP/fetch operations where you want to retry on transient failures
 */
export function isRetryableError(error: unknown): boolean {
  return isTransientError(error) || isRateLimitError(error) || isServerError(error)
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, delay = 500, factor = 2, maxDelay = 10000, retryIf = isTransientError } = options

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1 || !retryIf(error)) throw error
      const wait = Math.min(delay * Math.pow(factor, attempt), maxDelay)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  throw lastError
}
