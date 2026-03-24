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
import { getFilename } from "@opencode-ai/util/path"
import { retry } from "@opencode-ai/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeProviderList } from "./utils"
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

export async function bootstrapGlobal(input: {
  globalSDK: OpencodeClient
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
}) {
  const tasks = [
    retry(() =>
      input.globalSDK.path.get().then((x) => {
        input.setGlobalStore("path", x.data!)
      }),
    ),
    retry(() =>
      input.globalSDK.global.config.get().then((x) => {
        input.setGlobalStore("config", x.data!)
      }),
    ),
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
    retry(() =>
      input.globalSDK.provider.list().then((x) => {
        input.setGlobalStore("provider", normalizeProviderList(x.data!))
      }),
    ),
  ]

  const results = await Promise.allSettled(tasks)
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason)
  if (errors.length) {
    const message = formatServerError(errors[0], input.translate)
    const more = errors.length > 1 ? input.formatMoreCount(errors.length - 1) : ""
    showToast({
      variant: "error",
      title: input.requestFailedTitle,
      description: message + more,
    })
  }
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
    project: Project[]
    provider: ProviderListResponse
  }
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  if (seededProject) input.setStore("project", seededProject)
  if (input.store.provider.all.length === 0 && input.global.provider.all.length > 0) {
    input.setStore("provider", input.global.provider)
  }
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", input.global.config)
  }
  if (loading) input.setStore("status", "partial")

  const results = await Promise.allSettled([
    seededProject
      ? Promise.resolve()
      : retry(() => input.sdk.project.current()).then((x) => input.setStore("project", x.data!.id)),
    retry(() =>
      input.sdk.provider.list().then((x) => {
        input.setStore("provider", normalizeProviderList(x.data!))
      }),
    ),
    retry(() => input.sdk.app.agents().then((x) => input.setStore("agent", x.data ?? []))),
    retry(() => input.sdk.config.get().then((x) => input.setStore("config", x.data!))),
    retry(() =>
      input.sdk.path.get().then((x) => {
        input.setStore("path", x.data!)
        const next = projectID(x.data?.directory ?? input.directory, input.global.project)
        if (next) input.setStore("project", next)
      }),
    ),
    retry(() => input.sdk.command.list().then((x) => input.setStore("command", x.data ?? []))),
    retry(() => input.sdk.session.status().then((x) => input.setStore("session_status", x.data!))),
    input.loadSessions(input.directory),
    retry(() => input.sdk.mcp.status().then((x) => input.setStore("mcp", x.data!))),
    retry(() => input.sdk.lsp.status().then((x) => input.setStore("lsp", x.data!))),
    retry(() =>
      input.sdk.vcs.get().then((x) => {
        const next = x.data ?? input.store.vcs
        input.setStore("vcs", next)
        if (next?.branch) input.vcsCache.setStore("value", next)
      }),
    ),
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
  ])

  const errors = results
    .filter((item): item is PromiseRejectedResult => item.status === "rejected")
    .map((item) => item.reason)
  if (errors.length > 0) {
    console.error("Failed to bootstrap instance", errors[0])
    const project = getFilename(input.directory)
    showToast({
      variant: "error",
      title: input.translate("toast.project.reloadFailed.title", { project }),
      description: formatServerError(errors[0], input.translate),
    })
    return
  }

  if (loading) input.setStore("status", "complete")
}
