// Coalesces a burst of writes into one batch. The latest value per key wins, so a store that
// re-serializes on every mutation costs one row write per flush instead of one per change.
export function createWriteBehind<T>(input: {
  delay: number
  write: (batch: Map<string, T>) => void
  onError?: (error: unknown) => void
}) {
  const pending = new Map<string, T>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (closed || pending.size === 0) return
    const batch = new Map(pending)
    pending.clear()
    try {
      input.write(batch)
    } catch (error) {
      // The renderer already saw these writes succeed. Keep them queued so the next flush retries
      // them; anything written for the same key since then takes precedence.
      for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value)
      if (!input.onError) throw error
      input.onError(error)
    }
  }

  return {
    get: (key: string) => pending.get(key),
    has: (key: string) => pending.has(key),
    entries: () => pending.values(),
    set(key: string, value: T) {
      if (closed) return
      pending.set(key, value)
      timer ??= setTimeout(flush, input.delay)
    },
    drop(predicate: (value: T) => boolean) {
      for (const [key, value] of pending) if (predicate(value)) pending.delete(key)
    },
    flush,
    close() {
      flush()
      closed = true
    },
  }
}
