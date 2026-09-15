import { queryOptions, useQueryClient, type QueryClient } from "@tanstack/solid-query"
import type { Accessor } from "solid-js"
import type { ServerSDK } from "@/runtime/server/client"
import type { ServerConnection } from "@/runtime/server/registry"
import { useServerCtx, type ServerCtx } from "@/runtime/server/runtime"
import { normalizeProjectInfo } from "@/runtime/server/global-sync/utils"
import { worktreeInventoryViewKey } from "@/workspaces/inventory"

function workspaceProjectsQuery(sdk: ServerSDK) {
  return queryOptions({
    queryKey: [sdk.scope, "settings-workspace-project-metadata"],
    queryFn: () => sdk.api.project.list(),
    staleTime: 30_000,
  })
}

export function workspaceInventoryQuery(
  context: ServerCtx,
  client: QueryClient,
  projectID?: string,
  shouldRefresh = projectID !== undefined,
) {
  return queryOptions({
    queryKey: worktreeInventoryViewKey(context.sdk.scope, projectID),
    queryFn: async () =>
      Promise.all(
        (await client.fetchQuery(workspaceProjectsQuery(context.sdk)))
          .filter((project) => projectID === undefined || project.id === projectID)
          .map(async (project) => {
            const worktrees = (await context.sync.worktrees.list(project.id)) ?? [
              { directory: project.canonical },
              ...project.sandboxes.map((directory) => ({ directory })),
            ]
            if (shouldRefresh) void context.sync.worktrees.refresh(project.id)
            return normalizeProjectInfo({ ...project, worktrees })
          }),
      ),
    staleTime: 30_000,
  })
}

export function useWorkspacesPrefetch(
  server: Accessor<ServerConnection.Any | undefined>,
  projectID?: Accessor<string | undefined>,
) {
  const client = useQueryClient()
  const context = useServerCtx(server)
  return () => {
    const current = context()
    if (!current || current.sdk.connection.status() !== "connected") return
    const project = projectID?.()
    if (project) {
      void client.prefetchQuery(workspaceInventoryQuery(current, client, project, false))
      return
    }
    // Server-level hover warms metadata without booting every project's Location.
    void client.prefetchQuery(workspaceProjectsQuery(current.sdk))
  }
}
