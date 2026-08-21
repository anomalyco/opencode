import type { SessionInfo, SessionsResponse } from "@opencode-ai/client/promise"
import { pathKey } from "@/utils/path-key"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "./types"

export const HOME_V2_SESSION_PAGE_LIMIT = 5_000

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
) {
  const data: SessionInfo[] = []
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
    data.push(...response.data)
    if (response.data.length < HOME_V2_SESSION_PAGE_LIMIT || !response.cursor.next) return parseHomeSessionIndex(data)
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

export function retainHomeSessions(sessions: SessionInfo[], limit: number, now: number) {
  return [...Map.groupBy(sessions, (session) => pathKey(session.location.directory)).values()].flatMap((items) => {
    const sorted = items.toSorted((a, b) => {
      const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)
      return updated || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })
    const recent = sorted
      .slice(limit)
      .filter((session) => (session.time.updated ?? session.time.created) > now - SESSION_RECENT_WINDOW)
      .slice(0, SESSION_RECENT_LIMIT)
    return [...sorted.slice(0, limit), ...recent]
  })
}
