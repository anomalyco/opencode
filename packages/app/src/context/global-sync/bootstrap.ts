import type {
  Config,
  OpencodeClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
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
import { projectOwner } from "@/pages/layout/helpers"

// Minimal type for bootstrap - actual GlobalStore has more fields (rootByDomain, projectByDomain, etc.)
// but bootstrap only needs to set these core fields
type GlobalStoreMinimal = {
  ready: boolean
  path: Path
  project: Project[]
  config: Config
  provider: ProviderListResponse
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

export const loadGlobalConfigQuery = (sdk: OpencodeClient) =>
  queryOptions({
    queryKey: ["config"],
    queryFn: () => retry(() => sdk.global.config.get().then((x) => x.data!)),
  })

export const loadProjectsQuery = (sdk: OpencodeClient) =>
  queryOptions({
    queryKey: ["project"],
    queryFn: () =>
      retry(() =>
        sdk.project.list().then((x) => {
          return (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
        }),
      ),
  })

export async function bootstrapGlobal(input: {
  globalSDK: OpencodeClient
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  // Accept any SetStoreFunction-like function that can set the minimal fields
  // In practice this is SetStoreFunction<GlobalStore> which includes more fields
  setGlobalStore: ((...args: unknown[]) => unknown) & {
    <K extends keyof GlobalStoreMinimal>(key: K, value: GlobalStoreMinimal[K]): void
  }
}) {
  const fast = [
    () =>
      retry(() =>
        input.globalSDK.path.get().then((x) => {
          input.setGlobalStore("path", x.data!)
        }),
      ),
    () =>
      retry(() =>
        input.globalSDK.project.list().then((x) => {
          const projects = (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
          input.setGlobalStore("project", projects)
        }),
      ),
    () =>
      retry(() =>
        input.globalSDK.global.config.get().then((x) => {
          input.setGlobalStore("config", x.data!)
        }),
      ),
    () =>
      retry(() =>
        input.globalSDK.provider.list().then((x) => {
          input.setGlobalStore("provider", normalizeProviderList(x.data!))
        }),
      ),
  ]

  const slow: Array<() => Promise<unknown>> = []

  showErrors({
    errors: errors(await runAll(fast)),
    title: input.requestFailedTitle,
    translate: input.translate,
    formatMoreCount: input.formatMoreCount,
  })
  await waitForPaint()
  showErrors({
    errors: errors(await runAll(slow)),
    title: input.requestFailedTitle,
    translate: input.translate,
    formatMoreCount: input.formatMoreCount,
  })
  input.setGlobalStore("ready", true)
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
  return projectOwner(directory, projects)?.project.id
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

export const loadProvidersQuery = (directory: string | null, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "providers"],
    queryFn: () => retry(() => sdk.provider.list().then((x) => normalizeProviderList(x.data!))),
  })

export const loadAgentsQuery = (directory: string | null, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "agents"],
    queryFn: () => retry(() => sdk.app.agents().then((x) => normalizeAgentList(x.data))),
  })

export const loadPathQuery = (directory: string | null, sdk: OpencodeClient) =>
  queryOptions<Path>({
    queryKey: [directory, "path"],
    queryFn: () => retry(() => sdk.path.get().then((x) => x.data!)),
  })

export async function bootstrapDirectory(input: {
  directory: string
  sdk: OpencodeClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    path: Path
    project: Project[]
    provider: NormalizedProviderListResponse
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

  const fast = [
    () =>
      seededProject
        ? Promise.resolve()
        : retry(() => input.sdk.project.current()).then((x) => input.setStore("project", x.data!.id)),
    () => retry(() => input.sdk.config.get().then((x) => input.setStore("config", x.data!))),
    () =>
      retry(() =>
        input.sdk.path.get().then((x) => {
          input.setStore("path", x.data!)
          const next = projectID(x.data?.directory ?? input.directory, input.global.project)
          if (next) input.setStore("project", next)
        }),
      ),
    () => retry(() => input.sdk.session.status().then((x) => input.setStore("session_status", x.data!))),
    () =>
      retry(() =>
        input.sdk.vcs.get().then((x) => {
          const next = x.data
          input.setStore("vcs", next)
          input.vcsCache.setStore("value", next)
        }),
      ),
  ]

  const slow = [
    () => retry(() => input.sdk.app.agents().then((x) => input.setStore("agent", x.data ?? []))),
    () => retry(() => input.sdk.command.list().then((x) => input.setStore("command", x.data ?? []))),
    () =>
      retry(() =>
        input.sdk.permission.list().then((x) => {
          const grouped = groupBySession(
            (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
          )
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
          })
        }),
      ),
    () =>
      retry(() =>
        input.sdk.question.list().then((x) => {
          const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
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
          })
        }),
      ),
    () =>
      retry(() =>
        input.sdk.provider.list().then((x) => {
          input.setStore("provider", normalizeProviderList(x.data!))
        }),
      ),
    () => retry(() => input.sdk.mcp.status().then((x) => input.setStore("mcp", x.data!))),
    () => retry(() => input.sdk.lsp.status().then((x) => input.setStore("lsp", x.data!))),
  ]

    if (loading && slowErrs.length === 0) input.setStore("status", "complete")
  })()
}
