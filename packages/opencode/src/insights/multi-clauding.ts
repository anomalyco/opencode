const OVERLAP_WINDOW_MS = 30 * 60_000

// Use NUL as the separator: it is forbidden in UUIDs, in Postgres `text`
// values, and in any well-formed `session_id` we'd realistically encounter,
// so it cannot collide with the underlying string. (`:` previously could
// collide if a future session_id format contained a colon.)
const SEP = "\u0000"

export function detectMultiClauding(
  sessions: Array<{ session_id: string; user_message_timestamps_ms: number[] }>,
) {
  const all = sessions
    .flatMap((s) => s.user_message_timestamps_ms.map((ts) => ({ ts, sessionId: s.session_id })))
    .sort((a, b) => a.ts - b.ts)

  const pairs = new Set<string>()
  // Track participating-message **indices** in `all`, not (ts, sessionId)
  // strings — two messages with identical timestamps in the same session
  // (paste-flood, replay) used to collide in a Set keyed by `${ts}:${id}` and
  // silently undercount.
  const involvedMessageIndices = new Set<number>()
  const lastIndex = new Map<string, number>()
  let windowStart = 0

  for (let i = 0; i < all.length; i++) {
    const msg = all[i]!
    while (windowStart < i && msg.ts - all[windowStart]!.ts > OVERLAP_WINDOW_MS) {
      const expiring = all[windowStart]!
      if (lastIndex.get(expiring.sessionId) === windowStart) lastIndex.delete(expiring.sessionId)
      windowStart++
    }
    const prev = lastIndex.get(msg.sessionId)
    if (prev !== undefined) {
      // No `break` — `user_messages_during` is meant to capture the **volume**
      // of activity overlapping with this session's prev→curr gap, so we
      // record every interleaved foreign message, not just the first one.
      let foundOverlap = false
      for (let j = prev + 1; j < i; j++) {
        const between = all[j]!
        if (between.sessionId === msg.sessionId) continue
        pairs.add([msg.sessionId, between.sessionId].sort().join(SEP))
        involvedMessageIndices.add(j)
        foundOverlap = true
      }
      if (foundOverlap) {
        involvedMessageIndices.add(prev)
        involvedMessageIndices.add(i)
      }
    }
    lastIndex.set(msg.sessionId, i)
  }

  const involved = new Set<string>()
  for (const pair of pairs) {
    const parts = pair.split(SEP)
    if (parts[0]) involved.add(parts[0])
    if (parts[1]) involved.add(parts[1])
  }
  return {
    overlap_events: pairs.size,
    sessions_involved: involved.size,
    user_messages_during: involvedMessageIndices.size,
  }
}

export * as InsightsMultiClauding from "./multi-clauding"
