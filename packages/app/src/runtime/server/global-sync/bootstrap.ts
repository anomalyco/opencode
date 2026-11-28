import type { Config, Path } from "@/runtime/server/types"
import type { LocationGetInput, LocationGetOutput, ProjectListOutput } from "@opencode/client/promise"
import { retry } from "@opencode/util/retry"
import type { SetStoreFunction } from "solid-js/store"
import type { GlobalStore } from "./types"
import { normalizeProjectInfo } from "./utils"
import { QueryClient, queryOptions, useQueries } from "@tanstack/solid-query"
import type { ServerScope } from "@/runtime/server/scope"
import { withWorktreeInventory, worktreeInventoryKey } from "@/workspaces/inventory"

export const loadGlobalConfigQuery = (scope: ServerScope) =>
  queryOptions({
    queryKey: [scope, "config"],
    // TODO: Restore config loading when the V2 client exposes a config API.
    queryFn: async (): Promise<Config> => ({}),
  })

type ProjectApi = {
  readonly list: () => Promise<ProjectListOutput>
}

type LocationApi = { readonly get: (input?: LocationGetInput) => Promise<LocationGetOutput> }

// Metadata only, in the server's order (most recently active first). Worktree inventories load per project when a
// view shows it (see workspaces/inventory).
export const loadProjectsQuery = (scope: ServerScope, projects: ProjectApi) =>
  queryOptions({
    queryKey: [scope, "project"],
    queryFn: () =>
      retry(() =>
        projects
          .list()
          .then((items) => items.flatMap((project) => (project?.id ? [normalizeProjectInfo(project)] : []))),
      ),
  })

export function loadProjects(input: {
  scope: ServerScope
  project: ProjectApi
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  return input.queryClient.fetchQuery(loadProjectsQuery(input.scope, input.project)).then((data) =>
    input.setGlobalStore(
      "project",
      data.map((project) =>
        withWorktreeInventory(project, input.queryClient.getQueryData(worktreeInventoryKey(input.scope, project.id))),
      ),
    ),
  )
}

export async function bootstrapGlobal(input: {
  serverAPI: {
    readonly location: LocationApi
    readonly project: ProjectApi
  }
  scope: ServerScope
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  await Promise.allSettled([
    input.queryClient.fetchQuery(loadGlobalConfigQuery(input.scope)),
    input.queryClient
      .fetchQuery(loadPathQuery(input.scope, null, input.serverAPI.location))
      .then((data) => input.setGlobalStore("path", data)),
    loadProjects({
      scope: input.scope,
      project: input.serverAPI.project,
      setGlobalStore: input.setGlobalStore,
      queryClient: input.queryClient,
    }),
  ])
}

export function inferHomeDirectory(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const match = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\/Users\/[^/]+)(?=\/|$)/.exec(normalized)

  if (!match) return ""

  return path.includes("\\") ? match[1]!.replaceAll("/", "\\") : match[1]!
}

export const loadPathQuery = (scope: ServerScope, directory: string | null, api: LocationApi) =>
  queryOptions<Path>({
    queryKey: [scope, directory, "path"],
    queryFn: () =>
      api.get(directory ? { location: { directory } } : undefined).then((location) => ({
        state: "",
        config: "",
        worktree: location.project.directory,
        directory: location.directory,
        home: inferHomeDirectory(location.directory) || inferHomeDirectory(location.project.directory),
      })),
  })

/**
 * A server's global config and path, loaded once the server is connected. Each is read from the query list when it is
 * asked for: `useQueries` replaces its results whenever its options change, as they do when the connection status
 * does, so a result taken out of the list once keeps the state from before the server connected.
 */
export function createGlobalQueries(input: { scope: ServerScope; location: LocationApi; connected: () => boolean }) {
  const queries = useQueries(() => ({
    queries: [
      { ...loadGlobalConfigQuery(input.scope), enabled: input.connected() },
      { ...loadPathQuery(input.scope, null, input.location), enabled: input.connected() },
    ],
  }))

  return {
    config(): Config {
      const query = queries[0]

      if (query.isPending) return {}

      return query.data ?? {}
    },
    path(): Path {
      const empty = { state: "", config: "", worktree: "", directory: "", home: "" }
      const query = queries[1]

      if (query.isPending) return empty

      return query.data ?? empty
    },
  }
}
