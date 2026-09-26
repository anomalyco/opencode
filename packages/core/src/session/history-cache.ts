import type { SessionMessage } from "./message.js"

/**
 * L1 history cache: decoded session messages held between LLM steps so each
 * step reads only rows appended since the last read (`seq > watermark`)
 * instead of re-reading and re-decoding the whole transcript.
 *
 * Process-local by design. The projector (the only writer besides transfer
 * import and the one-time v1 migration, which runs before any cache exists)
 * runs in the same process as the session runners and drops entries on every
 * rewrite of an already-read row, so a cache entry can never go stale:
 *
 * - UPDATE of a row at or below the high-water mark (projector `updateMessage`)
 * - revert committed (rows are deleted)
 * - compaction ended (the boundary moves)
 * - transfer import (direct INSERT outside the projector)
 *
 * Aliasing invariant: entries returned from this cache must never be handed to
 * code that mutates messages in place. Today the runner converts history
 * through `toLLMMessages` before any plugin hook sees it, and that conversion
 * builds fresh objects, so cached `SessionMessage.Info` values are never
 * aliased into mutable request state.
 */

export interface Entry {
  /** seq of the newest row included; cached rows span the boundary in force when the entry was built up to here. */
  readonly watermark: number
  /** decoded entries in seq order */
  readonly entries: ReadonlyArray<{ readonly seq: number; readonly message: SessionMessage.Info }>
}

// sessionID -> boundary key -> entry. One entry per boundary per session; a
// boundary change (new compaction) replaces the entry for its key.
const cache = new Map<string, Map<string, Entry>>()

export const drop = (sessionID: string) => {
  cache.delete(sessionID)
}

/** Highest cached seq for a session across all boundaries, or -1 when nothing is cached. */
export const highWater = (sessionID: string): number => {
  let max = -1
  for (const entry of cache.get(sessionID)?.values() ?? []) if (entry.watermark > max) max = entry.watermark
  return max
}

export const get = (sessionID: string, boundaryKey: string): Entry | undefined =>
  cache.get(sessionID)?.get(boundaryKey)

export const put = (sessionID: string, boundaryKey: string, entry: Entry) => {
  let perSession = cache.get(sessionID)
  if (!perSession) {
    perSession = new Map()
    cache.set(sessionID, perSession)
  }
  perSession.set(boundaryKey, entry)
}

export * as HistoryCache from "./history-cache.js"
