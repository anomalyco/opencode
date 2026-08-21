import type { Config, Path, Project, ProviderAuthResponse } from "@/runtime/server/types"
import type {
  LocationGetInput,
  LocationGetOutput,
  ProjectCurrentInput,
  ProjectCurrentOutput,
  ProjectListOutput,
} from "@opencode-ai/client/promise"
import { showToast } from "@/shell/notifications/toast"
import { getFilename } from "@opencode-ai/util/path"
import { retry } from "@opencode-ai/util/retry"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State } from "./types"
import { cmp, normalizeProjectInfo } from "./utils"
import { formatServerError } from "@/runtime/server/errors"
import { QueryClient, queryOptions } from "@tanstack/solid-query"
import type { ServerScope } from "@/runtime/server/scope"
import type { ServerApi } from "@/runtime/server/api"
import { sameDirectory } from "@/workspaces/paths"

type GlobalStore = {
  path: Path
  project: Project[]
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    const timer = setTimeout(finish, 50)
    if (typeof requestAnimationFrame !== "function") return
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(timer)
        finish()
      }, 0)
    })
  })
}

function errors(list: PromiseSettledResult<unknown>[]) {
  return list.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason)
}

function runAll(list: Array<() => Promise<unknown>>) {
  return Promise.allSettled(list.map((item) => item()))
}

function showErrors(input: {
  errors: unknown[]
  title: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
}) {
  if (input.errors.length === 0) return
  const message = formatServerError(input.errors[0], input.translate)
  const more = input.errors.length > 1 ? input.formatMoreCount(input.errors.length - 1) : ""
  showToast({
    variant: "error",
    title: input.title,
    description: message + more,
  })
}

export const loadGlobalConfigQuery = (scope: ServerScope) =>
  queryOptions({
    queryKey: [scope, "config"],
    // TODO: Restore config loading when the V2 client exposes a config API.
    queryFn: async (): Promise<Config> => ({}),
  })

type ProjectApi = {
  readonly list: () => Promise<ProjectListOutput>
  readonly current: (input?: ProjectCurrentInput) => Promise<ProjectCurrentOutput>
}
type WorktreeApi = Pick<ServerApi["worktree"], "list">
type LocationApi = { readonly get: (input?: LocationGetInput) => Promise<LocationGetOutput> }

export const loadProjectsQuery = (scope: ServerScope, projects: ProjectApi, worktrees: WorktreeApi) =>
  queryOptions({
    queryKey: [scope, "project"],
    queryFn: () =>
      retry(() =>
        projects.list().then(async (items) => {
          return (
            await Promise.all(
              items
                .filter((project) => !!project?.id)
                .map(async (project) => {
                  const directories = await worktrees
                    .list({ projectID: project.id })
                    .catch(() => [
                      { directory: project.canonical },
                      ...(project.sandboxes ?? [])
                        .filter((directory) => !sameDirectory(project.canonical, directory))
                        .map((directory) => ({ directory })),
                    ])
                  return normalizeProjectInfo({
                    ...project,
                    sandboxes: directories
                      .map((item) => item.directory)
                      .filter((directory) => !sameDirectory(project.canonical, directory)),
                    worktrees: directories,
                  })
                }),
            )
          )
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
        }),
      ),
  })

export async function bootstrapGlobal(input: {
  serverAPI: {
    readonly location: LocationApi
    readonly project: ProjectApi
    readonly worktree: WorktreeApi
  }
  scope: ServerScope
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  const slow = [
    () => input.queryClient.fetchQuery(loadGlobalConfigQuery(input.scope)),
    () => input.queryClient.fetchQuery(loadPathQuery(input.scope, null, input.serverAPI.location)),
    () =>
      input.queryClient
        .fetchQuery(loadProjectsQuery(input.scope, input.serverAPI.project, input.serverAPI.worktree))
        .then((data) => input.setGlobalStore("project", data)),
  ]
  await runAll(slow)
  // showErrors({
  //   errors: errors(),
  //   title: input.requestFailedTitle,
  //   translate: input.translate,
  //   formatMoreCount: input.formatMoreCount,
  // })
}

function projectID(directory: string, projects: Project[]) {
  return projects.find((project) => project.worktree === directory || project.sandboxes?.includes(directory))?.id
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
        home: "",
      })),
  })

export async function bootstrapDirectory(input: {
  directory: string
  scope: ServerScope
  mcp: boolean
  api: {
    readonly project: ProjectApi
  }
  store: Store<State>
  setStore: SetStoreFunction<State>
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    path: Path
    project: Project[]
  }
  queryClient: QueryClient
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  if (seededProject) input.setStore("project", seededProject)
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", reconcile(input.global.config, { merge: false }))
  }
  if (loading) input.setStore("status", "partial")

  const slow = [
    seededProject
      ? undefined
      : () =>
          retry(() => input.api.project.current({ location: { directory: input.directory } })).then((project) =>
            input.setStore("project", project.id),
          ),
  ].filter((task): task is () => Promise<void> => !!task)

  await waitForPaint()
  const slowErrs = errors(await runAll(slow))
  if (slowErrs.length > 0) {
    console.error("Failed to finish bootstrap instance", slowErrs[0])
    const project = getFilename(input.directory)
    showToast({
      variant: "error",
      title: input.translate("toast.project.reloadFailed.title", { project }),
      description: formatServerError(slowErrs[0], input.translate),
    })
  }

  if (loading && slowErrs.length === 0) input.setStore("status", "complete")
}
