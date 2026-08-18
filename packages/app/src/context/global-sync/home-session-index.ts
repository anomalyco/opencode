import type { Event, Session, SessionV2Info, V2SessionListResponse } from "@opencode-ai/sdk/v2/client"
import type { QueryClient } from "@tanstack/solid-query"
import { trimSessions } from "./session-trim"
import { pathKey } from "@/utils/path-key"

export const HOME_V2_SESSION_PAGE_LIMIT = 5_000

export type HomeSessionEvent = {
  type: "session.created" | "session.updated" | "session.deleted"
  properties: { sessionID: string; info: Session }
}
export type HomeSessionEvents = {
  sequence: number
  entries: Array<{ sequence: number; event: HomeSessionEvent }>
}
export type HomeSessionIndex = {
  sessions: Session[]
  eventSequence: number
}

export const homeSessionIndexKey = (server: string) => ["home", "session-index", server] as const
export const homeSessionEventsKey = (server: string) => ["home", "session-events", server] as const

type HomeSessionPage = { data?: V2SessionListResponse }

export async function loadHomeSessionIndex(
  list: (
    input: { limit: number; order: "desc"; cursor?: string },
    options: { signal?: AbortSignal },
  ) => Promise<HomeSessionPage>,
  eventSequence = 0,
  signal?: AbortSignal,
) {
  const data: SessionV2Info[] = []
  let cursor: string | undefined

  for (;;) {
    const response = await list(
      {
        limit: HOME_V2_SESSION_PAGE_LIMIT,
        order: "desc",
        ...(cursor ? { cursor } : {}),
      },
      { signal },
    )
    const page = response.data!
    data.push(...page.data)
    if (page.data.length < HOME_V2_SESSION_PAGE_LIMIT || !page.cursor.next)
      return { sessions: parseHomeSessionIndex(data), eventSequence }
    cursor = page.cursor.next
  }
}

export function appendHomeSessionEvent(current: HomeSessionEvents | undefined, event: HomeSessionEvent) {
  const sequence = (current?.sequence ?? 0) + 1
  return {
    sequence,
    entries: [...(current?.entries ?? []), { sequence, event }],
  }
}

export function trimHomeSessionEvents(current: HomeSessionEvents | undefined, sequence: number): HomeSessionEvents {
  return {
    sequence: current?.sequence ?? sequence,
    entries: (current?.entries ?? []).filter((entry) => entry.sequence > sequence),
  }
}

export function homeSessionIndexSessions(index: HomeSessionIndex | undefined, events: HomeSessionEvents | undefined) {
  if (!index) return []
  return (events?.entries ?? [])
    .filter((entry) => entry.sequence > index.eventSequence)
    .reduce((sessions, entry) => applyHomeSessionEvent(sessions, entry.event), index.sessions)
}

export function homeSessionIndexRefresh(event: Event["type"], connected: boolean) {
  if (event === "server.connected") return { connected: true, refetch: connected }
  return {
    connected,
    refetch: event === "global.disposed" || event === "session.next.moved",
  }
}

export function createHomeSessionIndexCache(queryClient: QueryClient, server: string) {
  const indexKey = homeSessionIndexKey(server)
  const eventsKey = homeSessionEventsKey(server)
  let connected = false

  return {
    indexKey,
    eventsKey,
    eventSequence() {
      return queryClient.getQueryData<HomeSessionEvents>(eventsKey)?.sequence ?? 0
    },
    complete(sequence: number) {
      // Keep events received after the fetch began so its response cannot overwrite them.
      queryClient.setQueryData<HomeSessionEvents>(eventsKey, (current) => trimHomeSessionEvents(current, sequence))
    },
    sessions(index: HomeSessionIndex | undefined, events: HomeSessionEvents | undefined) {
      return homeSessionIndexSessions(index, events)
    },
    apply(event: HomeSessionEvent) {
      if (!queryClient.getQueryState(indexKey)) return
      const next = appendHomeSessionEvent(queryClient.getQueryData<HomeSessionEvents>(eventsKey), event)
      if (queryClient.isFetching({ queryKey: indexKey, exact: true }) > 0) {
        queryClient.setQueryData(eventsKey, next)
        return
      }

      const index = queryClient.getQueryData<HomeSessionIndex>(indexKey)
      if (index) {
        queryClient.setQueryData<HomeSessionIndex>(indexKey, {
          sessions: homeSessionIndexSessions(index, next),
          eventSequence: next.sequence,
        })
      }
      queryClient.setQueryData<HomeSessionEvents>(eventsKey, { sequence: next.sequence, entries: [] })
    },
    refresh(event: Event["type"]) {
      const result = homeSessionIndexRefresh(event, connected)
      connected = result.connected
      if (!result.refetch) return
      void queryClient.refetchQueries({ queryKey: indexKey, exact: true, type: "active" })
    },
  }
}

// TODO(v2): This deliberately dumb full-table scan is necessary because the
// current V2 API orders by creation time and cannot filter roots, archives, or
// multiple directories. A bounded page could omit an old session updated today.
// Once released, use client.v2.project.list() and client.v2.session.list({
// parentID: null, order: "desc" }), then remove this adapter and its V1 fields.
export function parseHomeSessionIndex(sessions: SessionV2Info[]): Session[] {
  return sessions.flatMap((item) => {
    if (item.parentID || typeof item.time.archived === "number") return []
    return [toLegacySummary(item)]
  })
}

export function retainHomeSessions(sessions: Session[], limit: number, now: number) {
  const grouped = Map.groupBy(sessions, (session) => pathKey(session.directory))
  return [...grouped.values()].flatMap((items) => trimSessions(items, { limit, permission: {}, now }))
}

export function applyHomeSessionEvent(sessions: Session[], event: HomeSessionEvent) {
  const info = event.properties.info
  const index = sessions.findIndex((session) => session.id === info.id)
  if (event.type === "session.deleted" || info.parentID || typeof info.time.archived === "number") {
    if (index === -1) return sessions
    return sessions.toSpliced(index, 1)
  }
  if (event.type !== "session.created" && event.type !== "session.updated") return sessions
  if (index === -1) return [...sessions, info]
  return sessions.with(index, info)
}

function toLegacySummary(session: SessionV2Info): Session {
  return {
    id: session.id,
    slug: session.id,
    projectID: session.projectID,
    workspaceID: session.location.workspaceID,
    directory: session.location.directory,
    path: session.subpath,
    parentID: session.parentID,
    cost: session.cost,
    tokens: session.tokens,
    title: session.title,
    agent: session.agent,
    model: session.model,
    version: "",
    time: session.time,
  }
}
