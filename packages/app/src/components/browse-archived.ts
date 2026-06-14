import { type Session } from "@opencode-ai/sdk/v2/client"

export type ArchivedEntry<T extends Session = Session> = {
  id: string
  title: string
  directory: string
  archivedAt: number
  session: T
}

// Builds the rows for the "browse archived sessions" discovery dialog. Roots only (children carry
// a parentID), archived only, most-recently-archived first. Generic over the session type so the
// raw passthrough (`entry.session`) keeps the caller's concrete type (e.g. `GlobalSession` from the
// experimental list endpoint) instead of widening to the base `Session`.
export function buildArchivedSessionEntries<T extends Session>(
  sessions: T[],
  fallbackTitle: string,
): ArchivedEntry<T>[] {
  return (
    sessions
      .filter((session) => !session.parentID)
      // Guard with `!= null` so an epoch-0 archived timestamp is retained as a valid archived
      // session; only `undefined`/`null` means "not archived".
      .filter((session) => session.time.archived != null)
      .map((session) => ({
        id: session.id,
        title: session.title || fallbackTitle,
        directory: session.directory,
        archivedAt: session.time.archived as number,
        session,
      }))
      // Primary: archivedAt descending. Explicit stable tie-break by id ascending so roots sharing
      // an archivedAt have a reproducible order regardless of fetch order (ES stable-sort is not
      // a reliable tie-break across input orderings).
      .sort((a, b) => b.archivedAt - a.archivedAt || a.id.localeCompare(b.id))
  )
}
