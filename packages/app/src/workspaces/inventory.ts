import type { QueryClient } from "@tanstack/solid-query"
import type { WorktreeDirectory } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import type { ServerScope } from "@/runtime/server/scope"
import type { Project } from "@/runtime/server/types"
import { pathKey } from "./path-key"
import { sameDirectory } from "./paths"

export function worktreeInventoryKey(scope: ServerScope, directory: string) {
  return [scope, "worktree", pathKey(directory)] as const
}

// Project metadata arrives without worktrees; a loaded inventory supplies the workspace list.
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

// Listing a project's worktrees boots its Location on the server and runs discovery, so only
// projects the user is looking at are loaded. Historical projects stay metadata-only.
export function createWorktreeInventory(input: {
  scope: ServerScope
  queryClient: QueryClient
  api: () => Pick<ServerApi["worktree"], "list">
  updated: (directory: string, worktrees: WorktreeDirectory[]) => void
}) {
  const options = (directory: string) => ({
    queryKey: worktreeInventoryKey(input.scope, directory),
    queryFn: () =>
      input
        .api()
        .list({ location: { directory } })
        .then((items) => {
          input.updated(directory, items)
          return items
        }),
    // `worktree.updated` and reconnect invalidation drive refreshes; time alone does not re-list.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  return {
    cached: (directory: string) =>
      input.queryClient.getQueryData<WorktreeDirectory[]>(worktreeInventoryKey(input.scope, directory)),
    load: (directory: string) => input.queryClient.fetchQuery(options(directory)).catch(() => undefined),
    // Only inventories some view already demanded are refreshed.
    refresh: (directory: string) => {
      if (!input.queryClient.getQueryState(worktreeInventoryKey(input.scope, directory))) return Promise.resolve()
      return input.queryClient.fetchQuery({ ...options(directory), staleTime: 0 }).catch(() => undefined)
    },
  }
}
