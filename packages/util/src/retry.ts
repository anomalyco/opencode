export interface RetryOptions {
  attempts?: number
  delay?: number
  factor?: number
  maxDelay?: number
  retryIf?: (error: unknown) => boolean
}

const transientMessages = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
]

function isTransientError(error: unknown) {
  if (!error) return false
  // oxlint-disable-next-line no-base-to-string -- Error input is intentionally normalized for message matching.
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return transientMessages.some((item) => message.includes(item))
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3
  const delay = options.delay ?? 500
  const factor = options.factor ?? 2
  const maxDelay = options.maxDelay ?? 10_000
  const retryIf = options.retryIf ?? isTransientError
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1 || !retryIf(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay * Math.pow(factor, attempt), maxDelay)))
    }
  }
  throw lastError
}
