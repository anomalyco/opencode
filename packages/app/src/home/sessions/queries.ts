import type { SessionInfo } from "@opencode/client/promise"
import { queryOptions, skipToken, useQueries, useQueryClient, type QueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import {
  HOME_SESSION_LIMIT,
  loadHomeSessionInventory,
  mergeHomeSessionIndex,
  retainHomeSessions,
  type HomeSessionInventory,
} from "./index"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session on mount.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

export function homeSessionsQuery(
  conn: ServerConnection.Any | undefined,
  ctx: ServerCtx | undefined,
  queryClient: QueryClient,
) {
  return queryOptions({
    queryKey: ["home-sessions", conn] as const,
    queryFn: ctx
      ? async ({ signal }) => {
          const result = await loadHomeSessionInventory(
            (input, options) => ctx.sdk.api.session.list(input, options),
            signal,
          )
          queryClient.setQueryData(["home-session-inventory", conn], result.inventory)
          return result.sessions
        }
      : skipToken,
    retry: false,
    staleTime: 30_000,
    // Returning to Home shows the last list and refreshes it, instead of loading again once the cache expires.
    gcTime: Infinity,
    refetchOnMount: true,
    refetchOnReconnect: true,
    select: selectSessions,
  })
}

// Home and the sidebar observe one query cache and overlay the same live session store.
export function createSessionIndexes(connections: Accessor<{ conn: ServerConnection.Any; ctx: ServerCtx }[]>) {
  const queryClient = useQueryClient()
  const queries = useQueries(() => ({
    queries: connections().map((item) => ({
      ...homeSessionsQuery(item.conn, item.ctx, queryClient),
      enabled: item.ctx.sdk.connection.status() === "connected",
    })),
  }))
  const inventories = useQueries(() => ({
    queries: connections().map((item) => ({
      queryKey: ["home-session-inventory", item.conn],
      queryFn: skipToken,
      gcTime: Infinity,
      select: (inventory: HomeSessionInventory) => () => inventory,
    })),
  }))

  createEffect(() => {
    connections().forEach((item) => {
      onCleanup(
        item.ctx.data.on("session.deleted", (event) => {
          queryClient.setQueryData<SessionInfo[]>(["home-sessions", item.conn], (current) =>
            current?.filter((session) => session.id !== event.data.sessionID),
          )
          queryClient.setQueryData<HomeSessionInventory>(["home-session-inventory", item.conn], (current) =>
            current?.filter((session) => session.id !== event.data.sessionID),
          )
        }),
      )
    })
  })

  return {
    sources: createMemo(() =>
      connections().map((item, index) => {
        const inventory = new Map((inventories[index]?.data?.() ?? []).map((session) => [session.id, session]))
        item.ctx.data.session.list().forEach((session) => {
          if (session.parentID || session.time.archived !== undefined) {
            inventory.delete(session.id)
            return
          }
          inventory.set(session.id, { id: session.id, projectID: session.projectID, location: session.location })
        })
        return {
          ...item,
          inventory: item.ctx.data.session.filterRemoved([...inventory.values()]),
          sessions: retainHomeSessions(
            item.ctx.data.session.apply(
              mergeHomeSessionIndex(
                queries[index]?.isPending ? [] : (queries[index]?.data?.() ?? []),
                item.ctx.data.session.list(),
              ),
            ),
            HOME_SESSION_LIMIT,
            Date.now(),
          ),
        }
      }),
    ),
    loading: () => queries.some((query) => query.isPending),
  }
}
