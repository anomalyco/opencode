// The SSE event queue is a sliding buffer: when it is full, offering another
// event silently evicts the oldest one, creating a gap the consumer never sees.
// A one-shot latch tracks that gap, but resetting it only when the queue drains
// back to empty misses sustained overflow — a producer faster than the consumer
// parks the queue at capacity and it never reaches zero, so the gap is signalled
// once and then lies about the stream being in sync forever.
//
// This latch instead treats "how long has the queue been full" as the episode:
// while overflow persists it re-signals on a cool-down, and a genuine partial
// drain (size dropping below capacity) re-arms an immediate signal for the next
// episode.
export interface DesyncLatch {
  shouldSignal(size: number): boolean
}

export function makeDesyncLatch(input: { capacity: number; intervalMs?: number; now?: () => number }): DesyncLatch {
  const intervalMs = input.intervalMs ?? 1000
  const now = input.now ?? Date.now
  let latched = false
  let lastSignalAt = 0

  return {
    shouldSignal(size) {
      if (size < input.capacity) {
        latched = false
        return false
      }
      const at = now()
      if (!latched || at - lastSignalAt >= intervalMs) {
        latched = true
        lastSignalAt = at
        return true
      }
      return false
    },
  }
}
