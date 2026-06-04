import type {
  Config,
  OpencodeClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { retry } from "@opencode-ai/core/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeProviderList } from "./utils"
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
      clearTimeout(timer)
      finish()
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
          const data = normalizeProviderList(x.data!)
          input.setGlobalStore("provider", data)
        }),
      ),
  ]

  const slow: Array<() => Promise<unknown>> = []

  const _fastErrs = errors(await runAll(fast))
  showErrors({
    errors: _fastErrs,
    title: input.requestFailedTitle,
    translate: input.translate,
    formatMoreCount: input.formatMoreCount,
  })
  await waitForPaint()
  const _slowErrs = errors(await runAll(slow))
  showErrors({
    errors: _slowErrs,
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

export function upsertProject(projects: Project[], project: Project) {
  const next = projects.filter((item) => item.id !== project.id)
  return [...next, project].sort((a, b) => cmp(a.id, b.id))
}

export async function bootstrapDirectory(input: {
  directory: string
  sdk: OpencodeClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  setProject?: (projects: Project[]) => void
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    project: Project[]
    provider: ProviderListResponse
  }
}) {
  const loading = input.store.status !== "complete"
  let projects = input.global.project
  const seededProject = projectID(input.directory, projects)
  if (seededProject) input.setStore("project", seededProject)
  if (input.store.provider.all.length === 0 && input.global.provider.all.length > 0) {
    input.setStore("provider", input.global.provider)
  }
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", input.global.config)
  }
  if (loading) input.setStore("status", "partial")

  const fast = [
    () =>
      retry(() => input.sdk.project.current()).then((x) => {
        const project = x.data!
        projects = upsertProject(projects, project)
        input.setProject?.(projects)
        const id = projectID(input.directory, projects) ?? project.id
        input.setStore("project", id)
      }),
    () => retry(() => input.sdk.config.get().then((x) => input.setStore("config", x.data!))),
    () =>
      retry(() =>
        input.sdk.path.get().then((x) => {
          input.setStore("path", x.data!)
          const next = projectID(x.data?.directory ?? input.directory, projects)
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
          const data = normalizeProviderList(x.data!)
          input.setStore("provider", data)
        }),
      ),
    () => retry(() => input.sdk.mcp.status().then((x) => input.setStore("mcp", x.data!))),
    () => retry(() => input.sdk.lsp.status().then((x) => input.setStore("lsp", x.data!))),
  ]

  const errs = errors(await runAll(fast))
  if (errs.length > 0) {
    console.error("Failed to bootstrap instance", errs[0])
    const project = getFilename(input.directory)
    showToast({
      variant: "error",
      title: input.translate("toast.project.reloadFailed.title", { project }),
      description: formatServerError(errs[0], input.translate),
    })
  }

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

  if (loading && errs.length === 0 && slowErrs.length === 0) input.setStore("status", "complete")
}
