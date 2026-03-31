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
import { getFilename } from "@opencode-ai/shared/util/path"
import { retry } from "@opencode-ai/shared/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeAgentList, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"

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

type BlockingKey = "project" | "provider" | "agent" | "config"
type DeferredKey =
  | "session_status"
  | "sessions"
  | "path"
  | "command"
  | "mcp"
  | "lsp"
  | "vcs"
  | "permission"
  | "question"

function hasProvider(provider: ProviderListResponse) {
  return provider.all.length > 0 || provider.connected.length > 0 || Object.keys(provider.default).length > 0
}

function hasConfig(config: Config) {
  return Object.keys(config).length > 0
}

function hasPath(path: Path) {
  return !!(path.state || path.config || path.worktree || path.directory || path.home)
}

export function getDirectoryBootstrapPlan(input: {
  skipHeavy?: boolean
  hasProvider: boolean
  hasConfig: boolean
  hasPath: boolean
}) {
  const blocking: BlockingKey[] = ["project"]
  const deferred: DeferredKey[] = ["session_status", "sessions"]

  if (!input.skipHeavy) {
    if (!input.hasProvider) blocking.push("provider")
    blocking.push("agent")
    if (!input.hasConfig) blocking.push("config")
    if (!input.hasPath) deferred.push("path")
    deferred.push("command", "mcp", "lsp")
  }

  deferred.push("vcs", "permission", "question")
  return { blocking, deferred }
}

export function getDirectorySeed<P, C, R>(input: {
  directory: string
  global: {
    path: { directory: string } & P
    config: C
    provider: R
  }
}): {
  path?: { directory: string } & P
  config?: C
  provider?: R
} {
  if (input.global.path.directory !== input.directory) return {}
  return {
    path: input.global.path,
    config: input.global.config,
    provider: input.global.provider,
  }
}
export async function bootstrapGlobal(input: {
  globalSDK: OpencodeClient
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
}) {
  const fast = [
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

  const slow = [
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
  ]
  await runAll(fast)
  // showErrors({
  //   errors: errors(await runAll(fast)),
  //   title: input.requestFailedTitle,
  //   translate: input.translate,
  //   formatMoreCount: input.formatMoreCount,
  // })
  await waitForPaint()
  await runAll(slow)
  // showErrors({
  //   errors: errors(),
  //   title: input.requestFailedTitle,
  //   translate: input.translate,
  //   formatMoreCount: input.formatMoreCount,
  // })
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
  skipHeavy?: boolean
  isReconnecting?: () => boolean
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  const seededPath = input.global.path.directory === input.directory ? input.global.path : undefined
  if (seededProject) input.setStore("project", seededProject)
  if (seededPath) input.setStore("path", seededPath)
  if (input.store.provider.all.length === 0 && input.global.provider.all.length > 0) {
    input.setStore("provider", input.global.provider)
  }
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", input.global.config)
  }
  if (loading || input.store.provider.all.length === 0) {
    input.setStore("provider_ready", false)
  }
  input.setStore("mcp_ready", false)
  input.setStore("mcp", {})
  input.setStore("lsp_ready", false)
  input.setStore("lsp", [])
  if (loading) input.setStore("status", "loading")

  const plan = getDirectoryBootstrapPlan({
    skipHeavy: input.skipHeavy,
    hasProvider: hasProvider(input.store.provider),
    hasConfig: hasConfig(input.store.config),
    hasPath: hasPath(input.store.path),
  })

  const blocking = {
    project: () =>
      seededProject
        ? Promise.resolve()
        : input.sdk.project.current().then((x) => input.setStore("project", x.data!.id)),
    provider: () =>
      input.sdk.provider.list().then((x) => {
        input.setStore("provider", normalizeProviderList(x.data!))
      }),
    agent: () => input.sdk.app.agents().then((x) => input.setStore("agent", normalizeAgentList(x.data))),
    config: () => input.sdk.config.get().then((x) => input.setStore("config", x.data!)),
  } satisfies Record<BlockingKey, () => Promise<void>>

  try {
    await Promise.all(plan.blocking.map((key) => retry(blocking[key])))
  } catch (err) {
    console.error("Failed to bootstrap instance", err)
    const project = getFilename(input.directory)
    if (!input.isReconnecting?.()) {
      showToast({
        variant: "error",
        title: input.translate("toast.project.reloadFailed.title", { project }),
        description: formatServerError(err, input.translate),
      })
    }
    input.setStore("status", "partial")
    return
  }

  if (input.store.status !== "complete") input.setStore("status", "partial")

  const requests = {
    session_status: () => input.sdk.session.status().then((x) => input.setStore("session_status", x.data!)),
    sessions: () => Promise.resolve(input.loadSessions(input.directory)).then(() => undefined),
    path: () =>
      seededPath
        ? Promise.resolve()
        : input.sdk.path.get().then((x) => {
            input.setStore("path", x.data!)
            const next = projectID(x.data?.directory ?? input.directory, input.global.project)
            if (next) input.setStore("project", next)
          }),
    command: () => input.sdk.command.list().then((x) => input.setStore("command", x.data ?? [])),
    mcp: () =>
      input.sdk.mcp.status().then((x) => {
        input.setStore("mcp", x.data!)
        input.setStore("mcp_ready", true)
      }),
    lsp: () =>
      input.sdk.lsp.status().then((x) => {
        input.setStore("lsp", x.data!)
        input.setStore("lsp_ready", true)
      }),
    vcs: () =>
      input.sdk.vcs.get().then((x) => {
        const next = x.data ?? input.store.vcs
        input.setStore("vcs", next)
        if (next) input.vcsCache.setStore("value", next)
      }),
    permission: () =>
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
    question: () =>
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
  } satisfies Record<DeferredKey, () => Promise<void>>

  void Promise.all(plan.deferred.map((key) => retry(requests[key]))).then(() => {
    input.setStore("status", "complete")
  })

  const rev = (providerRev.get(input.directory) ?? 0) + 1
  providerRev.set(input.directory, rev)
  void retry(() => input.sdk.provider.list())
    .then((x) => {
      if (providerRev.get(input.directory) !== rev) return
      input.setStore("provider", normalizeProviderList(x.data!))
      input.setStore("provider_ready", true)
    })
    .catch((err) => {
      if (providerRev.get(input.directory) !== rev) return
      console.error("Failed to refresh provider list", err)
      if (input.isReconnecting?.()) return
      const project = getFilename(input.directory)
      showToast({
        variant: "error",
        title: input.translate("toast.project.reloadFailed.title", { project }),
        description: formatServerError(err, input.translate),
      })
    })
}
