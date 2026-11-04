import type { SessionInfo, SessionsResponse } from "@opencode/client/promise"
import { pathKey } from "@/workspaces/path-key"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "@/runtime/server/global-sync/types"

export const HOME_V2_SESSION_PAGE_LIMIT = 5_000

export const HOME_SESSION_LIMIT = 64

// Rows kept per directory from the fetched index: the visible limit plus the
// recent-window search bucket. Merging locally known sessions and pending
// removals into this subset resolves exactly like merging into the complete
// index, so Home shows the same rows, order, and search results while the
// query cache and every per-update re-merge stay bounded by directory count.
export const HOME_SESSION_INDEX_LIMIT = HOME_SESSION_LIMIT + SESSION_RECENT_LIMIT

export async function loadHomeSessionIndex(
  list: (
    input: {
      limit: number
      order: "desc"
      parentID: null
      cursor?: string
    },
    options: { signal?: AbortSignal },
  ) => Promise<SessionsResponse>,
  signal?: AbortSignal,
  keep?: ReadonlySet<string>,
) {
  const now = Date.now()
  let retained: SessionInfo[] = []
  let cursor: string | undefined

  for (;;) {
    const response = await list(
      {
        limit: HOME_V2_SESSION_PAGE_LIMIT,
        order: "desc",
        parentID: null,
        ...(cursor ? { cursor } : {}),
      },
      { signal },
    )

    // Fold each page in as it arrives: pages are newest first, so later pages
    // can only fill directories that still have room. Peak allocation is one
    // page plus the retained subset, not the whole history.
    retained = retainHomeSessions(
      [...retained, ...parseHomeSessionIndex(response.data)],
      HOME_SESSION_INDEX_LIMIT,
      now,
      keep,
    )

    if (response.data.length < HOME_V2_SESSION_PAGE_LIMIT || !response.cursor.next) return retained
    cursor = response.cursor.next
  }
}

// Keep this filter for locally known sessions merged into the fetched index.
export function parseHomeSessionIndex(sessions: SessionInfo[]) {
  return sessions.filter((session) => !session.parentID && typeof session.time.archived !== "number")
}

export function mergeHomeSessionIndex(fetched: SessionInfo[], known: SessionInfo[]) {
  return parseHomeSessionIndex([
    ...new Map([...fetched, ...known].map((session) => [session.id, session] as const)).values(),
  ])
}

export function retainHomeSessions(
  sessions: SessionInfo[],
  limit: number,
  now: number,
  keep?: ReadonlySet<string>,
) {
  return [...Map.groupBy(sessions, (session) => pathKey(session.location.directory)).values()].flatMap((items) => {
    const sorted = items.toSorted((a, b) => {
      const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)

      return updated || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })

    // A pinned session must survive the per-directory window even when it is
    // older than every retained row, otherwise its row would vanish from Home.
    const kept = keep && keep.size > 0 ? sorted.filter((session) => keep.has(session.id)) : []
    const rest = keep && keep.size > 0 ? sorted.filter((session) => !keep.has(session.id)) : sorted
    const recent = rest
      .slice(limit)
      .filter((session) => (session.time.updated ?? session.time.created) > now - SESSION_RECENT_WINDOW)
      .slice(0, SESSION_RECENT_LIMIT)

    return [...kept, ...rest.slice(0, limit), ...recent]
  })
}
