import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Todo,
} from "@opencode-ai/sdk/v2/client"
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
import { Persist, persisted } from "@/utils/persist"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { bootstrapDirectory, bootstrapGlobal } from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { createRefreshQueue } from "./global-sync/queue"
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
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

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

  const [projectCache, setProjectCache, projectInit] = persisted(
    Persist.global("globalSync.project", ["globalSync.project.v1"]),
    createStore({ value: [] as Project[] }),
  )

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: projectCache.value,
    session_todo: {},
    provider: { all: [], connected: [], default: {} },
    provider_auth: {},
    config: {},
    reload: undefined,
  })
  const [loaded, setLoaded] = createStore({ dir: {} as Record<string, true> })

  let active = true
  let projectWritten = false
  let bootedAt = 0
  let bootingRoot = false
  let prevServer = server.current?.integration
  const claw = "/openclaw"
  const isolated = (directory: string) => server.current?.integration === "openclaw" && directory !== claw
  const trace = (_event: string, _extra?: Record<string, unknown>) => {}

  onCleanup(() => {
    active = false
  })

  const cacheProjects = () => {
    setProjectCache(
      "value",
      untrack(() => globalStore.project.map(sanitizeProject)),
    )
  }

  const setProjects = (next: Project[] | ((draft: Project[]) => void)) => {
    projectWritten = true
    if (typeof next === "function") {
      setGlobalStore("project", produce(next))
      cacheProjects()
      return
    }
    setGlobalStore("project", next)
    cacheProjects()
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => void))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  if (projectInit instanceof Promise) {
    void projectInit.then(() => {
      if (!active) return
      if (projectWritten) return
      const cached = projectCache.value
      if (cached.length === 0) return
      setGlobalStore("project", cached)
    })
  }

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
    bootstrap,
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
      queue.clear(directory)
      sessionMeta.delete(directory)
      sdkCache.delete(directory)
      clearSessionPrefetchDirectory(directory)
    },
    translate: language.t,
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
    if (isolated(directory)) {
      trace("loadSessions.skip", {
        directory,
        why: "openclaw-isolated",
        silent: !!opts?.silent,
      })
      return
    }
    const pending = sessionLoads.get(directory)
    if (pending) {
      trace("loadSessions.skip", {
        directory,
        why: "pending",
        silent: !!opts?.silent,
      })
      return pending
    }

    children.pin(directory)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    trace("loadSessions.start", {
      directory,
      silent: !!opts?.silent,
      status: store.status,
      sessions: store.sessions,
      count: store.session.length,
      path: store.path.directory,
    })
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
      trace("loadSessions.skip", {
        directory,
        why: "cached",
        limit: meta.limit,
        storeLimit: store.limit,
        count: store.session.length,
      })
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
        setLoaded("dir", directory, true)
        trace("loadSessions.done", {
          directory,
          fetched: nonArchived.length,
          count: sessions.length,
        })
      })
      .catch((err) => {
        console.error("Failed to load sessions", err)
        setStore("sessions", "idle")
        const note = permissionNotice(err, language.t, "session")
        setStore("session_error", note)
        trace("loadSessions.error", {
          directory,
          silent: !!opts?.silent,
          note,
          error: err instanceof Error ? err.message : String(err),
        })
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

    sessionLoads.set(directory, promise)
    promise.finally(() => {
      sessionLoads.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    if (!directory) return
    if (isolated(directory)) {
      trace("bootstrap.skip", {
        directory,
        why: "openclaw-isolated",
      })
      return
    }
    const pending = booting.get(directory)
    if (pending) {
      trace("bootstrap.skip", {
        directory,
        why: "pending",
      })
      return pending
    }

    children.pin(directory)
    const promise = (async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(directory)
      if (!cache) return
      trace("bootstrap.start", {
        directory,
        status: child[0].status,
        sessions: child[0].sessions,
        path: child[0].path.directory,
      })
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        translate: language.t,
      })
      setLoaded("dir", directory, true)
      trace("bootstrap.done", {
        directory,
        status: child[0].status,
        sessions: child[0].sessions,
        path: child[0].path.directory,
        project: child[0].project,
      })
    })()

    booting.set(directory, promise)
    promise.finally(() => {
      booting.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (directory === "global") {
      if (server.current?.integration === "openclaw") return
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          queue.refresh()
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        for (const directory of Object.keys(children.children)) {
          if (!loaded.dir[directory]) continue
          queue.push(directory)
        }
      }
      return
    }

    if (isolated(directory)) return
    const existing = children.children[directory]
    if (!existing) return
    children.mark(directory)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(directory),
      loadLsp: () => {
        sdkFor(directory)
          .lsp.status()
          .then((x) => setStore("lsp", x.data ?? []))
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directory)
    }
  })

  async function bootstrap() {
    bootingRoot = true
    try {
      await bootstrapGlobal({
        globalSDK: globalSDK.client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
      })
      bootedAt = Date.now()
    } finally {
      bootingRoot = false
    }
  }

  createEffect(
    on(
      () => globalSDK.version,
      () => {
        const nextServer = server.current?.integration
        const openclawSwitch =
          (prevServer === "openclaw" && nextServer !== "openclaw") ||
          (prevServer !== "openclaw" && nextServer === "openclaw")
        prevServer = nextServer
        const dirs = openclawSwitch ? ["/openclaw"] : Object.keys(children.children)
        trace("server.switch.reset", {
          openclawSwitch,
          dirs,
        })
        if (openclawSwitch) {
          booting.delete(claw)
          sessionLoads.delete(claw)
          sessionMeta.delete(claw)
        } else {
          for (const key of Array.from(booting.keys())) booting.delete(key)
          for (const key of Array.from(sessionLoads.keys())) sessionLoads.delete(key)
          sessionMeta.clear()
        }
        for (const directory of dirs) {
          if (!children.children[directory]) continue
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
        if (!openclawSwitch) void bootstrap()
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

  const updateConfig = async (config: Config) => {
    setGlobalStore("reload", "pending")
    return globalSDK.client.global.config
      .update({ config })
      .then(bootstrap)
      .then(() => {
        queue.refresh()
        setGlobalStore("reload", undefined)
        queue.refresh()
      })
      .catch((error) => {
        setGlobalStore("reload", undefined)
        throw error
      })
  }

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
    loaded(directory: string) {
      return !!loaded.dir[directory]
    },
    child: children.child,
    peek: children.peek,
    bootstrap,
    updateConfig,
    project: projectApi,
    todo: {
      set: setSessionTodo,
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
