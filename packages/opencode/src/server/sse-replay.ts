// Ring buffer of recent SSE events for client reconnect replay.
//
// When a long-lived SSE stream drops (proxy idle, browser tab backgrounded,
// network blip), the client may reconnect with a `Last-Event-ID` header. This
// buffer lets the server replay everything after that ID so the UI catches up
// instead of going stale while the agents keep running on the server.

const DEFAULT_RING_SIZE = 1024

export type StoredEvent = { id: number; data: string }

export class SSEReplayBuffer {
  private ring: StoredEvent[] = []
  private nextId = 0
  private listeners = new Set<(entry: StoredEvent) => void>()

  constructor(private maxSize: number = DEFAULT_RING_SIZE) {}

  /**
   * Assign a monotonic ID to `data`, store it in the ring, and notify all
   * live subscribers. Returns the stored entry (caller can read its id).
   */
  publish(data: string): StoredEvent {
    const entry: StoredEvent = { id: ++this.nextId, data }
    this.ring.push(entry)
    if (this.ring.length > this.maxSize) this.ring.shift()
    for (const fn of this.listeners) fn(entry)
    return entry
  }

  /**
   * Subscribe to live events. Returns an unsubscribe function.
   */
  subscribe(fn: (entry: StoredEvent) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /**
   * Snapshot of buffered events with id strictly greater than `lastEventId`.
   * Returns [] if the client is up to date or had no prior connection.
   * If the client was disconnected long enough that its last-seen id is older
   * than what we still have in the ring, the returned slice will start from
   * the oldest available — the client may detect a gap by comparing
   * `lastEventId + 1` to the first id received.
   */
  eventsAfter(lastEventId: number): StoredEvent[] {
    if (lastEventId <= 0) return []
    return this.ring.filter((e) => e.id > lastEventId)
  }
}

/**
 * Parse a `Last-Event-ID` request header into a numeric id. Returns 0 for
 * missing/invalid values (caller should treat 0 as "no replay").
 */
export function parseLastEventId(header: string | null | undefined): number {
  if (!header) return 0
  const n = parseInt(header, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}
