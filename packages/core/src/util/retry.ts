export interface RetryOptions {
  attempts?: number
  delay?: number
  factor?: number
  maxDelay?: number
  retryIf?: (error: unknown) => boolean
  /**
   * Treat a thrown `TypeError` as transient. `fetch` rejects with a bare
   * `TypeError` when the target server is unreachable and its message is
   * locale-dependent ("Failed to fetch", "ネットワークエラー", ...), so it cannot
   * be matched by text. Opt in only from callbacks whose failures are
   * exclusively network requests — otherwise a programming error inside the
   * callback would be silently re-run instead of failing fast.
   */
  retryOnTypeError?: boolean
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

function isTransientError(error: unknown, retryOnTypeError: boolean): boolean {
  if (!error) return false
  if (retryOnTypeError && error instanceof TypeError) return true
  // oxlint-disable-next-line no-base-to-string -- error is unknown, intentional coercion for message matching
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return TRANSIENT_MESSAGES.some((m) => message.includes(m))
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, delay = 500, factor = 2, maxDelay = 10000, retryIf } = options
  const shouldRetry = retryIf ?? ((error: unknown) => isTransientError(error, options.retryOnTypeError === true))

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1 || !shouldRetry(error)) throw error
      const wait = Math.min(delay * Math.pow(factor, attempt), maxDelay)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  throw lastError
}
