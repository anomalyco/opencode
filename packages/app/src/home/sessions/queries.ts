import type { SessionInfo } from "@opencode/client/promise"
import { queryOptions, skipToken } from "@tanstack/solid-query"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { LocalProject } from "@/shell/state/layout"
import { workspaceSelectionDirectories } from "@/workspaces/paths"
import { isSessionNotFoundError } from "@/runtime/server/errors"
import { looksLikeSessionID } from "@/session/search"
import { HOME_SESSION_INDEX_LIMIT, loadHomeSessionIndex } from "./index"
import { HOME_SESSIONS_FETCH_TIMEOUT_MS } from "./load-machine"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session on mount.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

export function homeSessionsQuery(conn: ServerConnection.Any | undefined, ctx: ServerCtx | undefined) {
  return queryOptions({
    queryKey: ["home-sessions", conn] as const,
    queryFn: ctx
      ? ({ signal }) => loadHomeSessionIndex((input, options) => ctx.sdk.api.session.list(input, options), signal)
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

export function projectSessionDirectories(project: LocalProject) {
  return [project.worktree, ...workspaceSelectionDirectories(project, [])]
}

export async function lookupHomeSession(ctx: ServerCtx, sessionID: string, signal?: AbortSignal) {
  const session = await ctx.sdk.api.session.get({ sessionID }, { signal }).catch((cause: unknown) => {
    if (!isSessionNotFoundError(cause, sessionID)) throw cause
  })

  return session && !session.time.archived ? session : undefined
}

/** Quiet projects can be missing entirely from the bounded server-wide index. Search each checkout directly. */
export function projectSessionsQuery(
  conn: ServerConnection.Any | undefined,
  ctx: ServerCtx | undefined,
  directories: string[] | undefined,
  search = "",
) {
  return queryOptions({
    queryKey: ["project-sessions", conn, directories, search] as const,
    retry: false,
    gcTime: 30_000,
    queryFn:
      ctx && directories
        ? async ({ signal }) => {
            // Older WebKit supports cancelling the query but has no AbortSignal.any.
            const deadline =
              "any" in AbortSignal && "timeout" in AbortSignal
                ? AbortSignal.any([signal, AbortSignal.timeout(HOME_SESSIONS_FETCH_TIMEOUT_MS)])
                : signal

            if (looksLikeSessionID(search)) {
              const exact = await lookupHomeSession(ctx, search, deadline)

              return { sessions: exact ? [exact] : [], partial: false }
            }

            const results = await Promise.allSettled(
              directories.map((directory) =>
                ctx.sdk.api.session.list(
                  {
                    directory,
                    parentID: null,
                    limit: HOME_SESSION_INDEX_LIMIT,
                    order: "desc",
                    search: search || undefined,
                  },
                  { signal: deadline },
                ),
              ),
            )

            const sessions = results.flatMap((result) => (result.status === "fulfilled" ? result.value.data : []))

            const failure = results.find((result) => result.status === "rejected")

            if (failure && results.every((result) => result.status === "rejected")) throw failure.reason

            return { sessions, partial: !!failure }
          }
        : skipToken,
    select: (result) => () => result,
  })
}
