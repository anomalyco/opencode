import type { Config, Path, Project, ProviderAuthResponse } from "@/types"
import type {
  AgentListInput,
  AgentListOutput,
  CatalogApi,
  CommandInfo,
  CommandListInput,
  CommandListOutput,
  IntegrationListInput,
  IntegrationListOutput,
  LocationGetInput,
  LocationGetOutput,
  PermissionRequest,
  ProjectCurrentInput,
  ProjectCurrentOutput,
  ProjectListOutput,
  ReferenceListInput,
  ReferenceListOutput,
  ReferenceInfo,
  QuestionRequest,
  SessionApi,
  SessionInfo,
} from "@opencode-ai/client/promise"
import { showToast } from "@/utils/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { retry } from "@opencode-ai/core/util/retry"
import { batch } from "solid-js"
import { produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State } from "./types"
import type { ServerSession } from "../server-session"
import { cmp, directoryKey, normalizeAgentList, normalizeProjectInfo, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"
import { QueryClient, queryOptions } from "@tanstack/solid-query"
import { loadMcpQuery, loadMcpResourcesQuery } from "../server-sync"
import { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { ScopedKey, type ServerScope } from "@/utils/server-scope"
import type { ServerApi } from "@/utils/server"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  provider: NormalizedProviderListResponse
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

const providerRev = new Map<string, number>()

export function clearProviderRev(scope: ServerScope, directory: string) {
  providerRev.delete(ScopedKey.from(scope, directory))
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
type LocationApi = { readonly get: (input?: LocationGetInput) => Promise<LocationGetOutput> }

type McpApi = ServerApi["mcp"]
type PermissionApi = ServerApi["permission"]
type QuestionApi = ServerApi["question"]
type VcsApi = ServerApi["vcs"]

export const loadProjectsQuery = (scope: ServerScope, api: ProjectApi) =>
  queryOptions({
    queryKey: [scope, "project"],
    queryFn: () =>
      retry(() =>
        api.list().then((projects) => {
          return projects
            .filter((p) => !!p?.id)
            .map(normalizeProjectInfo)
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
        }),
      ),
  })

export async function bootstrapGlobal(input: {
  serverAPI: CatalogApi & { readonly location: LocationApi; readonly project: ProjectApi }
  scope: ServerScope
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  const slow = [
    () => input.queryClient.fetchQuery(loadGlobalConfigQuery(input.scope)),
    () => input.queryClient.fetchQuery(loadProvidersQuery(input.scope, null, input.serverAPI)),
    () => input.queryClient.fetchQuery(loadPathQuery(input.scope, null, input.serverAPI.location)),
    () =>
      input.queryClient
        .fetchQuery(loadProjectsQuery(input.scope, input.serverAPI.project))
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

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

function projectID(directory: string, projects: Project[]) {
  return projects.find((project) => project.worktree === directory || project.sandboxes?.includes(directory))?.id
}

function mergeSession(setStore: SetStoreFunction<State>, session: SessionInfo) {
  setStore("session", (list) => {
    const next = list.slice()
    const idx = next.findIndex((item) => item.id >= session.id)
    if (idx === -1) return [...next, session]
    if (next[idx]?.id === session.id) {
      next[idx] = session
      return next
    }
    next.splice(idx, 0, session)
    return next
  })
}

function warmSessions(input: {
  ids: string[]
  store: Store<State>
  setStore: SetStoreFunction<State>
  api: SessionApi
}) {
  const known = new Set(input.store.session.map((item) => item.id))
  const ids = [...new Set(input.ids)].filter((id) => !!id && !known.has(id))
  if (ids.length === 0) return Promise.resolve()
  return Promise.all(
    ids.map((sessionID) =>
      retry(() => input.api.get({ sessionID })).then((session) => mergeSession(input.setStore, session)),
    ),
  ).then(() => undefined)
}

export const loadProvidersQuery = (scope: ServerScope, directory: string | null, sdk: CatalogApi) =>
  queryOptions({
    queryKey: [scope, directory, "providers"],
    queryFn: () =>
      retry(async () => {
        const location = directory ? { location: { directory } } : undefined
        const [providers, models, defaultModel] = await Promise.all([
          sdk.provider.list(location),
          sdk.model.list(location),
          sdk.model.default(location),
        ])
        return normalizeProviderList(providers.data, models.data, defaultModel.data)
      }),
  })

type AgentListApi = {
  readonly list: (input?: AgentListInput) => Promise<AgentListOutput>
}

type CommandListApi = {
  readonly list: (input?: CommandListInput) => Promise<CommandListOutput>
}

type IntegrationListApi = {
  readonly list: (input?: IntegrationListInput) => Promise<IntegrationListOutput>
}

type ReferenceListApi = {
  readonly list: (input?: ReferenceListInput) => Promise<ReferenceListOutput>
}

export const loadAgentsQuery = (scope: ServerScope, directory: string, sdk: AgentListApi) =>
  queryOptions({
    queryKey: [scope, directory, "agents"],
    queryFn: () => retry(() => sdk.list({ location: { directory } }).then((result) => normalizeAgentList(result.data))),
  })

export const loadIntegrationsQuery = (scope: ServerScope, directory: string | null, sdk: IntegrationListApi) =>
  queryOptions({
    queryKey: [scope, directory, "integrations"] as const,
    queryFn: () =>
      retry(() => sdk.list(directory ? { location: { directory } } : undefined).then((result) => result.data)),
  })

export const loadCommands = (directory: string, api: CommandListApi): Promise<CommandInfo[]> =>
  retry(() => api.list({ location: { directory } }).then((result) => result.data))

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

export const loadReferencesQuery = (scope: ServerScope, directory: string, api: ReferenceListApi) =>
  queryOptions<ReferenceInfo[]>({
    queryKey: [scope, directory, "references"] as const,
    queryFn: () => retry(() => api.list({ location: { directory } }).then((result) => result.data)).catch(() => []),
    placeholderData: [],
  })

export async function bootstrapDirectory(input: {
  directory: string
  scope: ServerScope
  mcp: boolean
  api: CatalogApi & {
    readonly agent: AgentListApi
    readonly command: CommandListApi
    readonly mcp: McpApi
    readonly permission: PermissionApi
    readonly project: ProjectApi
    readonly question: QuestionApi
    readonly reference: ReferenceListApi
    readonly session: SessionApi
    readonly vcs: VcsApi
    readonly location: LocationApi
  }
  store: Store<State>
  setStore: SetStoreFunction<State>
  loadSessions: (directory: string) => Promise<void> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    path: Path
    project: Project[]
    provider: NormalizedProviderListResponse
  }
  queryClient: QueryClient
  session?: ServerSession
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  const seededPath = input.global.path.directory === input.directory ? input.global.path : undefined
  if (seededProject) input.setStore("project", seededProject)
  if (seededPath) input.setStore("path", seededPath)
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", reconcile(input.global.config, { merge: false }))
  }
  if (loading) input.setStore("status", "partial")

  const revKey = ScopedKey.from(input.scope, input.directory)
  const rev = (providerRev.get(revKey) ?? 0) + 1
  providerRev.set(revKey, rev)
  const slow = [
    () => Promise.resolve(input.loadSessions(input.directory)),
    () =>
      input.queryClient
        .ensureQueryData(loadAgentsQuery(input.scope, directoryKey(input.directory), input.api.agent))
        .then((data) => input.setStore("agent", data)),
    !seededProject &&
      (() =>
        retry(() => input.api.project.current({ location: { directory: input.directory } })).then((project) =>
          input.setStore("project", project.id),
        )),
    !seededPath &&
      (() =>
        input.queryClient
          .ensureQueryData(loadPathQuery(input.scope, directoryKey(input.directory), input.api.location))
          .then((data) => {
            const next = projectID(data.directory ?? input.directory, input.global.project)
            if (next) input.setStore("project", next)
          })),
    input.mcp &&
      (() => loadCommands(input.directory, input.api.command).then((commands) => input.setStore("command", commands))),
    () =>
      input.queryClient.fetchQuery(
        loadReferencesQuery(input.scope, directoryKey(input.directory), input.api.reference),
      ),
    () =>
      retry(() =>
        input.api.permission.request
          .list({ location: { directory: input.directory } })
          .then((result) => result.data)
          .then((permissions) => {
            const ids = permissions.map((permission) => permission.sessionID)
            const grouped = groupBySession(
              permissions.filter((permission) => !!permission.id && !!permission.sessionID),
            )
            const warm = input.session
              ? Promise.all(ids.map((sessionID) => input.session!.resolve(sessionID))).then(() => undefined)
              : warmSessions({ ids, store: input.store, setStore: input.setStore, api: input.api.session })
            return warm.then(() =>
              batch(() => {
                const current = input.session?.data.permission ?? input.store.permission
                for (const sessionID of Object.keys(current)) {
                  if (grouped[sessionID]) continue
                  if (input.session?.get(sessionID)?.location.directory !== input.directory) continue
                  if (input.session) input.session.set("permission", sessionID, [])
                  if (!input.session) input.setStore("permission", sessionID, [])
                }
                for (const [sessionID, permissions] of Object.entries(grouped)) {
                  const value = reconcile(
                    permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
                    { key: "id" },
                  )
                  if (input.session) input.session.set("permission", sessionID, value)
                  if (!input.session) input.setStore("permission", sessionID, value)
                }
              }),
            )
          }),
      ),
    () =>
      retry(() =>
        input.api.question.request
          .list({ location: { directory: input.directory } })
          .then((result) => result.data)
          .then((questions) => {
            const ids = questions.map((question) => question.sessionID)
            const grouped = groupBySession(
              questions.filter((question) => !!question.id && !!question.sessionID) as QuestionRequest[],
            )
            const warm = input.session
              ? Promise.all(ids.map((sessionID) => input.session!.resolve(sessionID))).then(() => undefined)
              : warmSessions({ ids, store: input.store, setStore: input.setStore, api: input.api.session })
            return warm.then(() =>
              batch(() => {
                const current = input.session?.data.question ?? input.store.question
                for (const sessionID of Object.keys(current)) {
                  if (grouped[sessionID]) continue
                  if (input.session?.get(sessionID)?.location.directory !== input.directory) continue
                  if (input.session) input.session.set("question", sessionID, [])
                  if (!input.session) input.setStore("question", sessionID, [])
                }
                for (const [sessionID, questions] of Object.entries(grouped)) {
                  const value = reconcile(
                    questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
                    { key: "id" },
                  )
                  if (input.session) input.session.set("question", sessionID, value)
                  if (!input.session) input.setStore("question", sessionID, value)
                }
              }),
            )
          }),
      ),
    () => Promise.resolve(input.loadSessions(input.directory)),
    input.mcp &&
      (() => input.queryClient.fetchQuery(loadMcpQuery(input.scope, directoryKey(input.directory), input.api.mcp))),
    input.mcp &&
      (() =>
        input.queryClient.fetchQuery(loadMcpResourcesQuery(input.scope, directoryKey(input.directory), input.api.mcp))),
    () =>
      input.queryClient
        .fetchQuery(loadProvidersQuery(input.scope, directoryKey(input.directory), input.api))
        .catch((err) => {
          const project = getFilename(input.directory)
          showToast({
            variant: "error",
            title: input.translate("toast.project.reloadFailed.title", { project }),
            description: formatServerError(err, input.translate),
          })
        }),
  ].filter(Boolean) as (() => Promise<any>)[]

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
