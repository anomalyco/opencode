import type { Config, OpencodeClient, Path, Project, ProviderAuthResponse, Todo } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import {
  createContext,
  getOwner,
  createEffect,
  createSignal,
  onCleanup,
  on,
  type ParentProps,
  untrack,
  useContext,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  clearProviderRev,
  loadAgentsQuery,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { sanitizeProject } from "./global-sync/utils"
import { formatServerError, permissionNotice } from "@/utils/server-errors"
import { useServer } from "./server"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: NormalizedProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export const loadMcpQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "mcp"] as const,
    queryFn: () => sdk.mcp.status().then((r) => r.data ?? {}),
  })

export const loadLspQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "lsp"] as const,
    queryFn: () => sdk.lsp.status().then((r) => r.data ?? []),
  })

function makeQueryOptionsApi(globalSDK: () => OpencodeClient, sdkFor: (dir: PathKey) => OpencodeClient) {
  return {
    globalConfig: () => loadGlobalConfigQuery(globalSDK()),
    projects: () => loadProjectsQuery(globalSDK()),
    providers: (directory: PathKey | null) =>
      loadProvidersQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    path: (directory: PathKey | null) => loadPathQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    agents: (directory: PathKey) => loadAgentsQuery(directory, sdkFor(directory)),
    mcp: (directory: PathKey) => loadMcpQuery(directory, sdkFor(directory)),
    lsp: (directory: PathKey) => loadLspQuery(directory, sdkFor(directory)),
    sessions: (directory: PathKey) => ({ queryKey: [directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const server = useServer()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")
  const [version, setVersion] = createSignal(0)

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()

  const sdkFor = (directory: string) => {
    const key = directoryKey(directory)
    const cached = sdkCache.get(key)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(key, sdk)
    return sdk
  }

  const queryOptionsApi = makeQueryOptionsApi(() => globalSDK.client, sdkFor)

  const [configQuery, providerQuery, pathQuery] = useQueries(() => ({
    queries: [queryOptionsApi.globalConfig(), queryOptionsApi.providers(null), queryOptionsApi.path(null)],
  }))

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return bootstrap.isPending
    },
    project: [],
    session_todo: {},
    provider_auth: {},
    get path() {
      const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "" }
      if (pathQuery.isLoading) return EMPTY
      return pathQuery.data ?? EMPTY
    },
    get provider() {
      const EMPTY = { all: new Map(), connected: [], default: {} }
      if (providerQuery.isLoading) return EMPTY
      return providerQuery.data ?? EMPTY
    },
    get config() {
      if (configQuery.isLoading) return {}
      return configQuery.data ?? {}
    },
    get reload() {
      return updateConfigMutation.isPending ? "pending" : undefined
    },
  })
  const queryClient = useQueryClient()

  let bootedAt = 0
  let bootingRoot = false
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore("project", next)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const bootstrap = useQuery(() => ({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      await bootstrapGlobal({
        globalSDK: globalSDK.client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
      return bootedAt
    },
  }))

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: ["bootstrap"] }),
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      sdkCache.delete(key)
      clearProviderRev(key)
      clearSessionPrefetchDirectory(key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      provider: globalStore.provider,
    },
  })

  const sdkFor = (directory: string) => {
    const cached = sdkCache.get(directory)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(directory, sdk)
    return sdk
  }

  async function loadSessions(directory: string, opts?: { silent?: boolean }) {
    const pending = sessionLoads.get(directory)
    if (pending) return pending

    children.pin(key)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    setStore("sessions", "loading")
    setStore("session_error", undefined)
    const meta = sessionMeta.get(directory)
    if (meta && meta.limit >= store.limit) {
      const next = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
        cleanupDroppedSessionCaches(store, setStore, next, setSessionTodo)
      }
      setStore("sessions", "ready")
      setStore("session_error", undefined)
      children.unpin(directory)
      return
    }

    const limit = Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = loadRootSessionsWithFallback({
      directory,
      limit,
      list: (query) => globalSDK.client.session.list(query),
    })
      .then((x) => {
        const nonArchived = (x.data ?? [])
          .filter((s) => !!s?.id)
          .filter((s) => !s.time?.archived)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const limit = store.limit
        const childSessions = store.session.filter((s) => !!s.parentID)
        const sessions = trimSessions([...nonArchived, ...childSessions], {
          limit,
          permission: store.permission,
        })
        setStore(
          "sessionTotal",
          estimateRootSessionTotal({
            count: nonArchived.length,
            limit: x.limit,
            limited: x.limited,
          }),
        )
        setStore("session", reconcile(sessions, { key: "id" }))
        cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo)
        sessionMeta.set(directory, { limit })
        setStore("sessions", "ready")
        setStore("session_error", undefined)
      })
      .catch((err) => {
        console.error("Failed to load sessions", err)
        setStore("sessions", "idle")
        const note = permissionNotice(err, language.t, "session")
        setStore("session_error", note)
        if (opts?.silent || note) return
        const project = getFilename(directory)
        const title =
          server.current?.integration === "openclaw"
            ? language.t("toast.session.listFailed.openclaw.title")
            : language.t("toast.session.listFailed.title", { project })
        showToast({
          variant: "error",
          title,
          description: formatServerError(err, language.t),
        })
      })
      .then(() => {})

    sessionLoads.set(key, promise)
    void promise.finally(() => {
      sessionLoads.delete(key)
      children.unpin(key)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        translate: language.t,
        queryClient,
      })
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const key = directoryKey(directory)
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (directory === "global") {
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          bootstrap.refetch()
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        for (const directory of Object.keys(children.children)) {
          queue.push(directory)
        }
      }
      return
    }

    const existing = children.children[key]
    if (!existing) return
    children.mark(key)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(key),
      loadLsp: () => {
        void queryClient.fetchQuery(queryOptionsApi.lsp(key))
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  async function bootstrap() {
    await bootstrapGlobal({
      globalSDK: globalSDK.client,
      connectErrorTitle: language.t("dialog.server.add.error"),
      connectErrorDescription: language.t("error.globalSync.connectFailed", {
        url: globalSDK.url,
      }),
      requestFailedTitle: language.t("common.requestFailed"),
      translate: language.t,
      formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
      setGlobalStore: setBootStore,
    })
  }

  createEffect(
    on(
      () => globalSDK.version,
      () => {
        for (const key of Array.from(booting.keys())) booting.delete(key)
        for (const key of Array.from(sessionLoads.keys())) sessionLoads.delete(key)
        sessionMeta.clear()
        for (const directory of Object.keys(children.children)) {
          // Mounted views can keep references to child stores across a server switch.
          // Reset the store in place and drop cached clients so the next bootstrap/load
          // repopulates it from the newly active backend instead of stale OpenClaw data.
          queue.clear(directory)
          sdkCache.delete(directory)
          clearSessionPrefetchDirectory(directory)
          children.resetDirectory(directory)
        }
        setGlobalStore("reload", undefined)
        setVersion((x) => x + 1)
        void bootstrap()
      },
    ),
  )

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfigMutation = useMutation(() => ({
    mutationFn: (config: Config) => globalSDK.client.global.config.update({ config }),
    onSuccess: () => {
      bootstrap.refetch()
      // Invalidate all provider queries so newly configured custom providers
      // appear immediately in the available provider list across all directories.
      queryClient.invalidateQueries({ queryKey: [null, "providers"] })
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === "providers" })
    },
  }))

  const dirSyncContexts = new Map<string, ReturnType<typeof createDirSyncContext>>()
  const dirSyncContextRefCounts = new Map<string, number>()

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get version() {
      return version()
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    queryOptions: queryOptionsApi,
    // bootstrap,
    updateConfig: updateConfigMutation.mutateAsync,
    project: projectApi,
    todo: {
      set: setSessionTodo,
    },
    createDirSyncContext: (directory: string) => {
      onCleanup(() => {
        dirSyncContextRefCounts.set(directory, (dirSyncContextRefCounts.get(directory) ?? 0) - 1)
        if (dirSyncContextRefCounts.get(directory) === 0) {
          dirSyncContexts.delete(directory)
          dirSyncContextRefCounts.delete(directory)
        }
      })

      const cached = dirSyncContexts.get(directory)
      if (cached) {
        dirSyncContextRefCounts.set(directory, (dirSyncContextRefCounts.get(directory) ?? 0) + 1)
        return cached
      }
      const ctx = createDirSyncContext(globalSDK.createClient({ directory, throwOnError: true }), directory)
      dirSyncContexts.set(directory, ctx)
      dirSyncContextRefCounts.set(directory, 1)

      return ctx
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

export function useQueryOptions() {
  return useGlobalSync().queryOptions
}
