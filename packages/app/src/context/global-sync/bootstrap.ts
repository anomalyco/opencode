import type {
  Config,
  OpencodeClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Session,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { retry } from "@opencode-ai/core/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeAgentList, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"
import { QueryClient, queryOptions, skipToken } from "@tanstack/solid-query"
import { loadMcpQuery } from "../global-sync"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
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

export function clearProviderRev(directory: string) {
  providerRev.delete(directory)
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

export const loadGlobalConfigQuery = (
  sdk?: OpencodeClient,
  transform?: (x: Awaited<ReturnType<OpencodeClient["global"]["config"]["get"]>>) => void,
) =>
  queryOptions({
    queryKey: ["config"],
    queryFn: sdk
      ? () =>
          retry(() =>
            sdk.global.config.get().then((x) => {
              transform?.(x)
              return x.data!
            }),
          )
      : skipToken,
  })

export const loadProjectsQuery = (
  sdk?: OpencodeClient,
  transform?: (x: Awaited<ReturnType<OpencodeClient["project"]["list"]>>["data"]) => void,
) =>
  queryOptions({
    queryKey: ["project"],
    queryFn: sdk
      ? () =>
          retry(() =>
            sdk.project
              .list()
              .then((x) => {
                return (x.data ?? [])
                  .filter((p) => !!p?.id)
                  .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
                  .slice()
                  .sort((a, b) => cmp(a.id, b.id))
              })
              .then(transform),
          )
      : skipToken,
  })

export async function bootstrapGlobal(input: {
  globalSDK: OpencodeClient
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  const slow = [
    () => input.queryClient.fetchQuery(loadGlobalConfigQuery(input.globalSDK)),
    () => input.queryClient.fetchQuery(loadProvidersQuery(null, input.globalSDK)),
    () => input.queryClient.fetchQuery(loadPathQuery(null, input.globalSDK)),
    () =>
      input.queryClient.fetchQuery(
        loadProjectsQuery(input.globalSDK, (data) => input.setGlobalStore("project", data ?? [])),
      ),
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

function mergeSession(setStore: SetStoreFunction<State>, session: Session) {
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
  sdk: OpencodeClient
}) {
  const known = new Set(input.store.session.map((item) => item.id))
  const ids = [...new Set(input.ids)].filter((id) => !!id && !known.has(id))
  if (ids.length === 0) return Promise.resolve()
  return Promise.all(
    ids.map((sessionID) =>
      retry(() => input.sdk.session.get({ sessionID })).then((x) => {
        const session = x.data
        if (!session?.id) return
        mergeSession(input.setStore, session)
      }),
    ),
  ).then(() => undefined)
}

export const loadProvidersQuery = (directory: string | null, sdk?: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "providers"],
    queryFn: sdk ? () => retry(() => sdk.provider.list().then((x) => normalizeProviderList(x.data!))) : skipToken,
  })

export const loadAgentsQuery = (
  directory: string | null,
  sdk?: OpencodeClient,
  transform?: (x: Awaited<ReturnType<OpencodeClient["app"]["agents"]>>) => void,
) =>
  queryOptions({
    queryKey: [directory, "agents"],
    queryFn: sdk
      ? () =>
          retry(() =>
            sdk.app.agents().then((x) => {
              transform?.(x)
              return x.data!
            }),
          )
      : skipToken,
  })

export const loadPathQuery = (
  directory: string | null,
  sdk?: OpencodeClient,
  transform?: (x: Awaited<ReturnType<OpencodeClient["path"]["get"]>>) => void,
) =>
  queryOptions<Path>({
    queryKey: [directory, "path"],
    queryFn: sdk
      ? () =>
          retry(() =>
            sdk.path.get().then(async (x) => {
              transform?.(x)
              return x.data!
            }),
          )
      : skipToken,
  })

export async function bootstrapDirectory(input: {
  directory: string
  sdk: OpencodeClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    path: Path
    project: Project[]
    provider: ProviderListResponse
  }
  queryClient: QueryClient
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

  const rev = (providerRev.get(input.directory) ?? 0) + 1
  providerRev.set(input.directory, rev)
  ;(async () => {
    const slow = [
      () => Promise.resolve(input.loadSessions(input.directory)),
      () =>
        input.queryClient.ensureQueryData(
          loadAgentsQuery(input.directory, input.sdk, (x) => input.setStore("agent", normalizeAgentList(x.data))),
        ),
      () =>
        retry(() => input.sdk.config.get().then((x) => input.setStore("config", reconcile(x.data!, { merge: false })))),
      () => retry(() => input.sdk.session.status().then((x) => input.setStore("session_status", x.data!))),
      !seededProject &&
        (() => retry(() => input.sdk.project.current()).then((x) => input.setStore("project", x.data!.id))),
      !seededPath &&
        (() =>
          input.queryClient.ensureQueryData(
            loadPathQuery(input.directory, input.sdk, (x) => {
              const next = projectID(x.data?.directory ?? input.directory, input.global.project)
              if (next) input.setStore("project", next)
            }),
          )),
      () =>
        retry(() =>
          input.sdk.vcs.get().then((x) => {
            const next = x.data ?? input.store.vcs
            input.setStore("vcs", next)
            if (next) input.vcsCache.setStore("value", next)
          }),
        ),
      () => retry(() => input.sdk.command.list().then((x) => input.setStore("command", x.data ?? []))),
      () =>
        retry(() =>
          input.sdk.permission.list().then((x) => {
            const ids = (x.data ?? []).map((perm) => perm?.sessionID).filter((id): id is string => !!id)
            const grouped = groupBySession(
              (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
            )
            return warmSessions({ ids, store: input.store, setStore: input.setStore, sdk: input.sdk }).then(() =>
              batch(() => {
                for (const sessionID of Object.keys(input.store.permission)) {
                  if (grouped[sessionID]) continue
                  input.setStore("permission", sessionID, [])
                }
                for (const [sessionID, permissions] of Object.entries(grouped)) {
                  input.setStore(
                    "permission",
                    sessionID,
                    reconcile(
                      permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
                      { key: "id" },
                    ),
                  )
                }
              }),
            )
          }),
        ),
      () =>
        retry(() =>
          input.sdk.question.list().then((x) => {
            const ids = (x.data ?? []).map((question) => question?.sessionID).filter((id): id is string => !!id)
            const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
            return warmSessions({ ids, store: input.store, setStore: input.setStore, sdk: input.sdk }).then(() =>
              batch(() => {
                for (const sessionID of Object.keys(input.store.question)) {
                  if (grouped[sessionID]) continue
                  input.setStore("question", sessionID, [])
                }
                for (const [sessionID, questions] of Object.entries(grouped)) {
                  input.setStore(
                    "question",
                    sessionID,
                    reconcile(
                      questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
                      { key: "id" },
                    ),
                  )
                }
              }),
            )
          }),
        ),
      () => Promise.resolve(input.loadSessions(input.directory)),
      () => input.queryClient.fetchQuery(loadMcpQuery(input.directory, input.sdk)),
      () =>
        input.queryClient.fetchQuery(loadProvidersQuery(input.directory, input.sdk)).catch((err) => {
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
  })()
}
