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
import { getFilename } from "@opencode-ai/core/util/path"
import {
  getOwner,
  createEffect,
  createSignal,
  onCleanup,
  on,
  type ParentProps,
  untrack,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"
import type { InitError } from "../pages/error"
import { GlobalSyncProvider as GlobalSyncContextProvider, useGlobalSync } from "./global-sync-context"
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

export type GlobalStore = {
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
  const revs = new Map<string, number>()
  const queues = new Map<DomainId, ReturnType<typeof createRefreshQueue>>()
  const bootedAt = new Map<DomainId, number>()
  const bootingRoot = new Map<DomainId, boolean>()

  const currentDomain = () => server.domain
  const rev = (directory: string) => revs.get(directory) ?? 0
  const bump = (directory: string, why: string) => {
    const next = rev(directory) + 1
    revs.set(directory, next)
    return next
  }
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
  // A directory is only "isolated" (skip bootstrap/load/event application) when its
  // domain has no registered server to talk to. Visible-domain no longer gates hidden
  // domains; each domain runs in parallel so long as it has an active server.
  const isolated = (directory: string) => !server.currentFor(domainFromDirectory(directory))

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
    setGlobalStore(
      "rootByDomain",
      produce((draft) => {
        const root = draft[domain] ?? blankRoot()
        draft[domain] = {
          ...root,
          [key]: value,
        }
      }),
    )
    if (domain !== currentDomain()) return
    ;(setGlobalStore as (...args: unknown[]) => unknown)(key, value)
  }

  const bootStoreFor = (domain: DomainId) =>
    ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjectsFor(domain, input[1] as Project[])
      return input[1]
    }
    if (
      typeof input[0] === "string" &&
      ["ready", "error", "path", "provider", "provider_auth", "config", "reload"].includes(input[0])
    ) {
      setRoot(domain, input[0] as keyof ReturnType<typeof blankRoot>, input[1])
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
    setGlobalStore(
      "sessionTodoByDomain",
      produce((draft) => {
        const bucket = draft[domain] ?? {}
        bucket[sessionID] = todos
        draft[domain] = bucket
      }),
    )
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

  type ChildManager = ReturnType<typeof createChildStoreManager>
  const managers = new Map<DomainId, ChildManager>()
  const managerFor = (domain: DomainId): ChildManager => {
    const cached = managers.get(domain)
    if (cached) return cached
    const manager = createChildStoreManager({
      owner,
      isBooting: (directory) => booting.has(directory),
      isLoadingSessions: (directory) => sessionLoads.has(directory),
      onBootstrap: (directory) => {
        void bootstrapInstance(directory).catch((err) => {
          console.error(
            `[global-sync] bootstrap trigger failed directory=${directory} err=${err instanceof Error ? err.message : String(err)}`,
          )
        })
      },
      onDispose: (directory) => {
        bump(directory, "dispose")
        queueFor(domain).clear(directory)
        sessionMeta.delete(directory)
        sdkCache.delete(directory)
        clearSessionPrefetchDirectory(directory)
      },
      translate: language.t,
    })
    managers.set(domain, manager)
    return manager
  }
  const managerOf = (directory: string): ChildManager => managerFor(domainFromDirectory(directory))
  const forEachDirectory = (visit: (directory: string, manager: ChildManager) => void) => {
    for (const manager of managers.values()) {
      for (const directory of Object.keys(manager.children)) {
        visit(directory, manager)
      }
    }
  }
  const directoriesInDomain = (domain: DomainId) => {
    const manager = managers.get(domain)
    if (!manager) return [] as string[]
    return Object.keys(manager.children)
  }
  const children = {
    child: (directory: string, options?: Parameters<ChildManager["child"]>[1]) =>
      managerOf(directory).child(directory, options),
    peek: (directory: string, options?: Parameters<ChildManager["peek"]>[1]) =>
      managerOf(directory).peek(directory, options),
    ensureChild: (directory: string) => managerOf(directory).ensureChild(directory),
    pin: (directory: string) => managerOf(directory).pin(directory),
    unpin: (directory: string) => managerOf(directory).unpin(directory),
    mark: (directory: string) => managerOf(directory).mark(directory),
    disposeDirectory: (directory: string) => managerOf(directory).disposeDirectory(directory),
    resetDirectory: (directory: string) => managerOf(directory).resetDirectory(directory),
    projectMeta: (directory: string, patch: ProjectMeta) => managerOf(directory).projectMeta(directory, patch),
    projectIcon: (directory: string, value: string | undefined) =>
      managerOf(directory).projectIcon(directory, value),
    lookup: (directory: string) => managerOf(directory).children[directory],
    vcsCache: {
      get: (directory: string) => managerOf(directory).vcsCache.get(directory),
    },
  }

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
      return
    }
    const pending = sessionLoads.get(directory)
    if (pending) {
      return pending
    }

    children.pin(directory)
    const child = children.child(directory, { bootstrap: false })
    const mark = rev(directory)
    const raw = child[1] as (...args: unknown[]) => unknown
    const store = child[0]
    const setStore = ((...input: unknown[]) => {
      if (rev(directory) !== mark || managerOf(directory).children[directory] !== child) return input[0]
      return raw(...input)
    }) as typeof child[1]
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
      })
      .catch((err) => {
        console.error(
          `[global-sync] failed to load sessions directory=${directory} err=${err instanceof Error ? err.message : String(err)}`,
        )
        setStore("sessions", "idle")
        const note = permissionNotice(err, language.t, "session")
        setStore("session_error", note)
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
      return
    }
    const pending = booting.get(directory)
    if (pending) {
      return pending
    }

    children.pin(directory)
    const promise = (async () => {
      const child = children.ensureChild(directory)
      const mark = rev(directory)
      const raw = child[1] as (...args: unknown[]) => unknown
      const setStore = ((...input: unknown[]) => {
        if (rev(directory) !== mark || managerOf(directory).children[directory] !== child) return input[0]
        return raw(...input)
      }) as typeof child[1]
      const cache = children.vcsCache.get(directory)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          project: projectBucket(domainFromDirectory(directory)),
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore,
        setProject: (projects) => setProjectsFor(domainFromDirectory(directory), projects),
        vcsCache: cache,
        translate: language.t,
      })
      setLoaded("dir", directory, true)
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
      // Route to the emitting domain's bucket regardless of which domain is visible.
      // Hidden domains must continue to process their own global events.
      applyGlobalEvent({
        event,
        project: projectBucket(emittingDomain),
        refresh: () => {
          if (recent) return
          // Extra-agent server.connected should not trigger a full main-domain bootstrap.
          // Only the main domain's own events should refresh the main domain.
          if (emittingDomain !== mainDomain) {
            return
          }
          queueFor(emittingDomain).refresh()
        },
        setGlobalProject: (next) => setProjectsFor(emittingDomain, next),
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        for (const directory of directoriesInDomain(emittingDomain)) {
          if (!loaded.dir[directory]) continue
          queueFor(emittingDomain).push(directory)
        }
      }
      return
    }

    // Cross-domain event bleed guard: a directory event coming from a different
    // domain than the directory itself is a bug — drop it instead of applying.
    if (emittingDomain !== dirDomain) return
    if (isolated(directory)) return
    const existing = managerOf(directory).children[directory]
    if (!existing) return
    children.mark(directory)
    const [store, setStore] = existing
    try {
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
    } catch (err) {
      const props = (event as { properties?: unknown }).properties as
        | {
            messageID?: string
            partID?: string
            part?: { id?: string; messageID?: string; type?: string }
          }
        | undefined
      console.error(
        `[global-sync] directory event failed directory=${directory} domain=${dirDomain} type=${event.type} recent=${recent ? 1 : 0} status=${store.status} sessions=${store.sessions} path=${store.path.directory} messageID=${props?.messageID ?? props?.part?.messageID ?? ""} partID=${props?.partID ?? props?.part?.id ?? ""} partType=${props?.part?.type ?? ""} err=${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  })

  onCleanup(unsub)
  onCleanup(() => {
    for (const queue of queues.values()) queue.dispose()
    queues.clear()
  })
  onCleanup(() => {
    forEachDirectory((directory, manager) => {
      manager.disposeDirectory(directory)
    })
  })

  async function bootstrap(domain = currentDomain()) {
    bootingRoot.set(domain, true)
    try {
      await bootstrapGlobal({
        globalSDK: runtime(domain).client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: bootStoreFor(domain),
      })
      await Promise.allSettled(
        directoriesInDomain(domain)
          .filter((directory) => loaded.dir[directory])
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
        const serverChanged = prevServer !== nextServer
        prevServer = nextServer
        const dirs = directoriesInDomain(nextDomain)
        if (!domainSwitch && serverChanged) {
          for (const dir of dirs) {
            booting.delete(dir)
            sessionLoads.delete(dir)
            sessionMeta.delete(dir)
            bump(dir, "server-reset")
          }
        }
        for (const directory of dirs) {
          if (!managerFor(nextDomain).children[directory]) continue
          if (!domainSwitch && serverChanged) {
            queueFor(nextDomain).clear(directory)
            sdkCache.delete(directory)
            clearSessionPrefetchDirectory(directory)
            children.resetDirectory(directory)
          }
        }
        setGlobalStore("reload", undefined)
        setVersion((x) => x + 1)
        if (!domainSwitch && serverChanged) void bootstrap(nextDomain)
      },
    ),
  )

  const projectApi = {
    loadSessions,
    warm(directory: string) {
      void bootstrapInstance(directory)
    },
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
      forEachDirectory((directory, manager) => {
        const child = manager.children[directory]
        if (!child) return
        child[1]("provider", (prev) => stripProvider(prev, id))
      })
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

export { createGlobalSync, useGlobalSync }

export function useQueryOptions() {
  return {
    mcp: (directory: string) => ({ queryKey: [directory, "mcp"] as const }),
    lsp: (directory: string) => ({ queryKey: [directory, "lsp"] as const }),
    agents: (directory: string) => ({ queryKey: [directory, "agents"] as const }),
    providers: (directory: string | null) => ({ queryKey: [directory, "providers"] as const }),
    path: (directory: string | null) => ({ queryKey: [directory, "path"] as const }),
    sessions: (directory: string) => ({ queryKey: [directory, "loadSessions"] as const }),
    projects: () => ({ queryKey: ["projects"] as const }),
    globalConfig: () => ({ queryKey: ["globalConfig"] as const }),
  }
}

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return <GlobalSyncContextProvider value={value}>{props.children}</GlobalSyncContextProvider>
}
