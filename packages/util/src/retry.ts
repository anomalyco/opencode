export interface RetryOptions {
  attempts?: number
  delay?: number
  factor?: number
  maxDelay?: number
  retryIf?: (error: unknown) => boolean
  signal?: AbortSignal
}

const transientMessages = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "econnreset",
  "econnrefused",
  "epipe",
  "etimedout",
  "socket hang up",
]

// Generated clients wrap fetch failures as ClientError("Transport", { cause }) and Bun/Node put the
// network detail in `code`, so the transient signal may sit anywhere along the cause chain.
export function isTransientError(error: unknown, depth = 0): boolean {
  if (!error) return false
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : ""
  // oxlint-disable-next-line no-base-to-string -- Error input is intentionally normalized for message matching.
  const message = `${String(error instanceof Error ? error.message : error)} ${code}`.toLowerCase()
  if (transientMessages.some((item) => message.includes(item))) return true
  if (!(error instanceof Error) || depth >= 5) return false
  return isTransientError(error.cause, depth + 1)
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3
  const delay = options.delay ?? 500
  const factor = options.factor ?? 2
  const maxDelay = options.maxDelay ?? 10_000
  const retryIf = options.retryIf ?? isTransientError
  const signal = options.signal
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted()
    try {
      const value = await operation()
      signal?.throwIfAborted()
      return value
    } catch (error) {
      signal?.throwIfAborted()
      lastError = error
      if (attempt === attempts - 1 || !retryIf(error)) throw error
      await new Promise<void>((resolve, reject) => {
        signal?.throwIfAborted()
        const timer = setTimeout(done, Math.min(delay * Math.pow(factor, attempt), maxDelay))
        function done() {
          signal?.removeEventListener("abort", cancel)
          resolve()
        }
        function cancel() {
          clearTimeout(timer)
          reject(signal?.reason)
        }
        signal?.addEventListener("abort", cancel, { once: true })
      })
    }
  }
  throw lastError
}
