import { QueryClient, queryOptions } from "@tanstack/solid-query"
import type { WorktreeDirectory } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import type { ServerScope } from "@/runtime/server/scope"
import type { Project } from "@/runtime/server/types"
import { pathKey } from "./path-key"
import { sameDirectory } from "./paths"

export function worktreeInventoryKey(scope: ServerScope, directory: string) {
  return [scope, "worktree", pathKey(directory)] as const
}

export function withWorktreeInventory(project: Project, worktrees: readonly WorktreeDirectory[] | undefined): Project {
  if (!worktrees) return project
  return {
    ...project,
    worktrees: [...worktrees],
    sandboxes: worktrees
      .map((item) => item.directory)
      .filter((directory) => !sameDirectory(project.worktree, directory)),
  }
}

// Owned by one server context. Only picker/settings observers demand these queries;
// metadata bootstrap never enumerates directories. QueryClient owns cache and deduplication.
export function createWorktreeInventory(input: {
  scope: ServerScope
  queryClient: QueryClient
  api: () => Pick<ServerApi["worktree"], "list">
  updated?: (directory: string, worktrees: readonly WorktreeDirectory[]) => void
}) {
  let active = 0
  const waiting: Array<() => void> = []
  const query = (directory: string) =>
    queryOptions({
      queryKey: worktreeInventoryKey(input.scope, directory),
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
      queryFn: ({ signal }) =>
        new Promise<WorktreeDirectory[]>((resolve, reject) => {
          const cancel = () => {
            const index = waiting.indexOf(run)
            if (index >= 0) waiting.splice(index, 1)
            reject(signal.reason)
          }
          const run = () => {
            signal.removeEventListener("abort", cancel)
            if (signal.aborted) {
              reject(signal.reason)
              return
            }
            active++
            // list already refreshes the server inventory; do not call refresh first.
            void input
              .api()
              .list({ location: { directory } }, { signal })
              .then((items) => {
                signal.throwIfAborted()
                input.updated?.(directory, items)
                resolve(items)
              })
              .catch(reject)
              .finally(() => {
                active--
                waiting.shift()?.()
              })
          }
          if (active < 4) return run()
          waiting.push(run)
          signal.addEventListener("abort", cancel, { once: true })
        }),
    })
  return {
    query,
    invalidate: (directory: string) =>
      input.queryClient.invalidateQueries(
        {
          queryKey: worktreeInventoryKey(input.scope, directory),
          exact: true,
          refetchType: "active",
        },
        { cancelRefetch: false },
      ),
  }
}
