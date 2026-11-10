import type { SessionInfo } from "@opencode/client/promise"
import { mergeHomeSessionIndex } from "@/home/sessions/index"

// Loading a tab refreshes its metadata, not its place in the project list. A newer idle marker means a run ended
// after the index was fetched, which is the one server change that may move the session. Recency overrides are
// applied afterward by the shared desktop data layer, which also owns send promotion and the rename guard.
export function mergeSidebarSessions(indexed: SessionInfo[], known: SessionInfo[]) {
  const timestamps = new Map(indexed.map((session) => [session.id, session.time] as const))

  return mergeHomeSessionIndex(
    indexed,
    known.map((session) => {
      const indexedTime = timestamps.get(session.id)

      if (!indexedTime) return session

      if ((session.time.idle ?? 0) > (indexedTime.idle ?? 0)) return session

      return { ...session, time: { ...session.time, updated: indexedTime.updated } }
    }),
  )
}
