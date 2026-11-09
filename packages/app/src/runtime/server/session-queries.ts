import type { SessionInfo } from "@opencode/client/promise"
import { queryOptions, skipToken, type QueryClient } from "@tanstack/solid-query"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import { loadSessionIndex } from "./session-index"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session on mount.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

export function sessionIndexQuery(
  conn: ServerConnection.Any | undefined,
  ctx: ServerCtx | undefined,
  queryClient: QueryClient,
) {
  return queryOptions({
    queryKey: ["home-sessions", conn] as const,
    queryFn: ctx
      ? async ({ signal }) => {
          const result = await loadSessionIndex((input, options) => ctx.sdk.api.session.list(input, options), signal)
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
