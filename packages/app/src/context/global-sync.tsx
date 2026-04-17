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
import { sanitizeProject, stripProvider } from "./global-sync/utils"
import { formatServerError, permissionNotice } from "@/utils/server-errors"
import { useServer } from "./server"
import {
  domainFromDirectory,
  extraAgentByIntegration,
  isExtraAgentIntegration,
  mainDomain,
  type DomainId,
} from "@/pages/layout/extra-agents"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  rootByDomain: Partial<
    Record<
      DomainId,
      Omit<GlobalStore, "projectByDomain" | "sessionTodoByDomain" | "project" | "session_todo" | "rootByDomain">
    >
  >
  projectByDomain: Partial<Record<DomainId, Project[]>>
  sessionTodoByDomain: Partial<Record<DomainId, Record<string, Todo[]>>>
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
  const queues = new Map<DomainId, ReturnType<typeof createRefreshQueue>>()
  const bootedAt = new Map<DomainId, number>()
  const bootingRoot = new Map<DomainId, boolean>()

  const currentDomain = () => server.domain
  const blankRoot = () => ({
    ready: false,
    error: undefined as InitError | undefined,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    provider: { all: [], connected: [], default: {} } as ProviderListResponse,
    provider_auth: {} as ProviderAuthResponse,
    config: {} as Config,
    reload: undefined as undefined | "pending" | "complete",
  })
  const rootBucket = (domain = currentDomain()) => globalStore.rootByDomain[domain] ?? blankRoot()
  const projectBucket = (domain = currentDomain()) => globalStore.projectByDomain[domain] ?? []
  const todoBucket = (domain = currentDomain()) => globalStore.sessionTodoByDomain[domain] ?? {}
  const runtime = (domain = currentDomain()) => globalSDK.forDomain(domain)

  const [projectCache, setProjectCache, projectInit] = persisted(
    {
      ...Persist.global("globalSync.project", ["globalSync.project.v1"]),
      migrate(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return { domains: { [mainDomain]: [] as Project[] } }
        if ("domains" in value) return value
        const list = Array.isArray((value as { value?: unknown }).value)
          ? ((value as { value: Project[] }).value ?? [])
          : []
        return { domains: { [mainDomain]: list } }
      },
    },
    createStore({ domains: { [mainDomain]: [] as Project[] } as Partial<Record<DomainId, Project[]>> }),
  )

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    ...blankRoot(),
    rootByDomain: {},
    projectByDomain: projectCache.domains,
    sessionTodoByDomain: {},
    project: projectCache.domains[mainDomain] ?? [],
    session_todo: {},
  })
  const [loaded, setLoaded] = createStore({ dir: {} as Record<string, true> })

  let active = true
  let projectWritten = false
  let prevServer = server.current?.integration
  const isolated = (directory: string) =>
    isExtraAgentIntegration(server.current?.integration) && directory !== `/${server.current?.integration}`
  const trace = (_event: string, _extra?: Record<string, unknown>) => {}

  onCleanup(() => {
    active = false
  })

  createEffect(
    on(
      currentDomain,
      (domain) => {
        const root = rootBucket(domain)
        setGlobalStore("ready", root.ready)
        setGlobalStore("error", root.error)
        setGlobalStore("path", reconcile(root.path))
        setGlobalStore("provider", reconcile(root.provider))
        setGlobalStore("provider_auth", reconcile(root.provider_auth))
        setGlobalStore("config", reconcile(root.config))
        setGlobalStore("reload", root.reload)
        setGlobalStore("project", reconcile(projectBucket(domain)))
        setGlobalStore("session_todo", reconcile(todoBucket(domain)))
      },
      { defer: false },
    ),
  )

  const cacheProjects = (domain = currentDomain()) => {
    setProjectCache(
      "domains",
      domain,
      untrack(() => projectBucket(domain).map(sanitizeProject)),
    )
  }

  const setProjectsFor = (domain: DomainId, next: Project[] | ((draft: Project[]) => void)) => {
    projectWritten = true
    if (typeof next === "function") {
      const mutate = next
      setGlobalStore(
        "projectByDomain",
        domain,
        produce<Project[] | undefined>((draft) => {
          if (!draft) return
          mutate(draft)
        }),
      )
      if (domain === currentDomain()) setGlobalStore("project", produce(mutate))
      cacheProjects(domain)
      return
    }
    setGlobalStore("projectByDomain", domain, next)
    if (domain === currentDomain()) setGlobalStore("project", next)
    cacheProjects(domain)
  }

  const setProjects = (next: Project[] | ((draft: Project[]) => void)) => setProjectsFor(currentDomain(), next)

  const setRoot = (domain: DomainId, key: keyof ReturnType<typeof blankRoot>, value: unknown) => {
    ;(setGlobalStore as (...args: unknown[]) => unknown)("rootByDomain", domain, key, value)
    if (domain !== currentDomain()) return
    ;(setGlobalStore as (...args: unknown[]) => unknown)(key, value)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjectsFor(currentDomain(), input[1] as Project[])
      return input[1]
    }
    if (
      typeof input[0] === "string" &&
      ["ready", "error", "path", "provider", "provider_auth", "config", "reload"].includes(input[0])
    ) {
      setRoot(currentDomain(), input[0] as keyof ReturnType<typeof blankRoot>, input[1])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => void))
      return input[1]
    }
    if (
      typeof input[0] === "string" &&
      ["ready", "error", "path", "provider", "provider_auth", "config", "reload"].includes(input[0])
    ) {
      setRoot(currentDomain(), input[0] as keyof ReturnType<typeof blankRoot>, input[1])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  if (projectInit instanceof Promise) {
    void projectInit.then(() => {
      if (!active) return
      if (projectWritten) return
      const cached = projectCache.domains[currentDomain()] ?? []
      if (cached.length === 0) return
      setGlobalStore("projectByDomain", currentDomain(), cached)
      setGlobalStore("project", cached)
    })
  }

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    const domain = currentDomain()
    if (!todos) {
      setGlobalStore(
        "sessionTodoByDomain",
        domain,
        produce((draft) => {
          if (!draft) return
          delete draft[sessionID]
        }),
      )
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("sessionTodoByDomain", domain, sessionID, reconcile(todos, { key: "id" }))
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined
  const queueFor = (domain = currentDomain()) => {
    const existing = queues.get(domain)
    if (existing) return existing
    const queue = createRefreshQueue({
      paused,
      bootstrap: () => bootstrap(domain),
      bootstrapInstance,
    })
    queues.set(domain, queue)
    return queue
  }

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      queueFor(domainFromDirectory(directory)).clear(directory)
      sessionMeta.delete(directory)
      sdkCache.delete(directory)
      clearSessionPrefetchDirectory(directory)
    },
    translate: language.t,
  })

  const sdkFor = (directory: string) => {
    const cached = sdkCache.get(directory)
    if (cached) return cached
    const sdk = runtime(domainFromDirectory(directory)).createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(directory, sdk)
    return sdk
  }

  async function loadSessions(directory: string, opts?: { silent?: boolean; force?: boolean }) {
    if (isolated(directory)) {
      trace("loadSessions.skip", {
        directory,
        why: "extra-agent-isolated",
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
    if (!opts?.force && meta && meta.limit >= store.limit) {
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
      list: (query) => runtime(domainFromDirectory(directory)).client.session.list(query),
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
        const agent = extraAgentByIntegration(server.current?.integration)
        const title = agent?.sessionListFailedTitleKey
          ? language.t(agent.sessionListFailedTitleKey)
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
        why: "extra-agent-isolated",
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
          project: projectBucket(),
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

  const unsub = globalSDK.listenAll((e) => {
    const directory = e.name
    const event = e.details
    const emittingDomain = e.domain
    const dirDomain = directory === "global" ? emittingDomain : domainFromDirectory(directory)
    const recent = !!bootingRoot.get(dirDomain) || Date.now() - (bootedAt.get(dirDomain) ?? 0) < 1500

    if (directory === "global") {
      if (emittingDomain !== currentDomain()) return
      if (isExtraAgentIntegration(server.current?.integration)) return
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          queueFor(currentDomain()).refresh()
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        for (const directory of Object.keys(children.children)) {
          if (!loaded.dir[directory]) continue
          queueFor(domainFromDirectory(directory)).push(directory)
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
      push: queueFor(dirDomain).push,
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
    for (const queue of queues.values()) queue.dispose()
    queues.clear()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directory)
    }
  })

  async function bootstrap(domain = currentDomain()) {
    bootingRoot.set(domain, true)
    try {
      await bootstrapGlobal({
        globalSDK: runtime(domain).client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
      })
      await Promise.allSettled(
        Object.keys(children.children)
          .filter((directory) => loaded.dir[directory] && domainFromDirectory(directory) === domain)
          .map((directory) => bootstrapInstance(directory)),
      )
      bootedAt.set(domain, Date.now())
    } finally {
      bootingRoot.set(domain, false)
    }
  }

  createEffect(
    on(
      () => globalSDK.version,
      () => {
        const nextServer = server.current?.integration
        const prevDomain = prevServer
          ? isExtraAgentIntegration(prevServer)
            ? `extra-agent/${prevServer}`
            : mainDomain
          : mainDomain
        const nextDomain = server.domain
        const domainSwitch = prevDomain !== nextDomain
        prevServer = nextServer
        const dirs = Object.keys(children.children).filter((directory) => domainFromDirectory(directory) === nextDomain)
        trace("server.switch.reset", {
          domainSwitch,
          prevDomain,
          nextDomain,
          dirs,
        })
        if (!domainSwitch) {
          for (const dir of dirs) {
            booting.delete(dir)
            sessionLoads.delete(dir)
            sessionMeta.delete(dir)
          }
        }
        for (const directory of dirs) {
          if (!children.children[directory]) continue
          if (!domainSwitch) {
            queueFor(domainFromDirectory(directory)).clear(directory)
            sdkCache.delete(directory)
            clearSessionPrefetchDirectory(directory)
            children.resetDirectory(directory)
          }
        }
        setGlobalStore("reload", undefined)
        setVersion((x) => x + 1)
        if (!domainSwitch) void bootstrap(nextDomain)
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

  const providerApi = {
    remove(id: string) {
      if (!id) return
      setGlobalStore("provider", (prev) => stripProvider(prev, id))
      for (const directory of Object.keys(children.children)) {
        const child = children.children[directory]
        if (!child) continue
        child[1]("provider", (prev) => stripProvider(prev, id))
      }
    },
  }

  const updateConfig = async (config: Config) => {
    setGlobalStore("reload", "pending")
    return runtime()
      .client.global.config.update({ config })
      .then(() => bootstrap())
      .then(() => {
        queueFor().refresh()
        setGlobalStore("reload", undefined)
        queueFor().refresh()
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
    provider: providerApi,
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
