import type { Config, Path, Project, ProviderAuthResponse } from "@/types"
import { showToast } from "@/utils/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { batch, createMemo, getOwner, onCleanup, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { type ServerEvent, type ServerSDK } from "./server-sdk"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  clearProviderRev,
  loadAgentsQuery,
  loadCommands,
  loadGlobalConfigQuery,
  loadIntegrationsQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent } from "./global-sync/event-reducer"
import { estimateRootSessionTotal, loadRootSessions } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { formatServerError } from "@/utils/server-errors"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { SolidQueryOptions } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey } from "./global-sync/utils"
import { pathKey, PathKey } from "@/utils/path-key"
import { createDirSyncContext } from "./directory-sync"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { createRefCountMap } from "@/utils/refcount"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { retry } from "@opencode-ai/core/util/retry"
import type { ServerScope } from "@/utils/server-scope"
import { createHomeSessionIndexCache } from "./global-sync/home-session-index"
import { persisted } from "@/utils/persist"
import type { ServerApi } from "@/utils/server"
import type {
  McpListInput,
  McpListOutput,
  McpResource,
  McpResourceCatalogInput,
  McpResourceCatalogOutput,
  McpServer,
  SessionActiveOutput,
  SessionStatus,
} from "@opencode-ai/client/promise"
import { toggleMcp } from "./global-sync/mcp"
import { createServerSession, type ServerSession } from "./server-session"
import { createCatalogSync } from "./server-sync/catalog"
import { createConnectionSync } from "./server-sync/connection"
import { usePlatform } from "./platform"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  provider: NormalizedProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

const SESSION_LIST_EVENTS = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.moved",
  "session.forked",
  "session.renamed",
  "session.usage.updated",
])

type McpListApi = {
  readonly list: (input?: McpListInput) => Promise<McpListOutput>
}

type McpResourceApi = {
  readonly resource: {
    readonly catalog: (input?: McpResourceCatalogInput) => Promise<McpResourceCatalogOutput>
  }
}

type ApiQueryOptions<T, K extends readonly unknown[]> = SolidQueryOptions<T, Error, T, K> & {
  initialData?: undefined
  queryKey: K
}

type SessionActiveApi = {
  readonly active: () => Promise<SessionActiveOutput>
}

export const loadMcpQuery = (
  scope: ServerScope,
  directory: string,
  api: McpListApi,
): ApiQueryOptions<Record<string, McpServer["status"]>, readonly [ServerScope, string, "mcp"]> =>
  queryOptions<
    Record<string, McpServer["status"]>,
    Error,
    Record<string, McpServer["status"]>,
    readonly [ServerScope, string, "mcp"]
  >({
    queryKey: [scope, directory, "mcp"] as const,
    queryFn: async () => {
      return api
        .list({ location: { directory } })
        .then((result) => Object.fromEntries(result.data.map((server) => [server.name, server.status])))
    },
  })

export const loadMcpResourcesQuery = (
  scope: ServerScope,
  directory: string,
  api: McpResourceApi,
): ApiQueryOptions<Record<string, McpResource>, readonly [ServerScope, string, "mcpResources"]> =>
  queryOptions<
    Record<string, McpResource>,
    Error,
    Record<string, McpResource>,
    readonly [ServerScope, string, "mcpResources"]
  >({
    queryKey: [scope, directory, "mcpResources"] as const,
    queryFn: async () => {
      return api.resource
        .catalog({ location: { directory } })
        .then((result) =>
          Object.fromEntries(result.data.resources.map((resource) => [`${resource.server}:${resource.uri}`, resource])),
        )
    },
    placeholderData: {},
  })

export const loadLspQuery = (scope: ServerScope, directory: string) =>
  queryOptions({
    queryKey: [scope, directory, "lsp"] as const,
    // TODO: Restore LSP status when the V2 client exposes an LSP API.
    queryFn: async () => [],
  })

export const loadActiveSessionsQuery = (
  scope: ServerScope,
  api: SessionActiveApi,
): ApiQueryOptions<SessionActiveOutput, readonly [ServerScope, "activeSessions"]> =>
  queryOptions<SessionActiveOutput, Error, SessionActiveOutput, readonly [ServerScope, "activeSessions"]>({
    queryKey: [scope, "activeSessions"] as const,
    queryFn: () => api.active(),
    enabled: true,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

export function seedActiveSessionStatuses(
  session: Pick<ServerSession, "data" | "set">,
  active: SessionActiveOutput | Record<string, SessionStatus>,
) {
  for (const sessionID of Object.keys(active)) {
    if (session.data.session_status[sessionID] !== undefined) continue
    const status = active[sessionID]
    session.set("session_status", sessionID, status?.type === "running" ? { type: "busy" } : status)
  }
}

export function reconcileActiveSessionStatuses(
  session: Pick<ServerSession, "data" | "set">,
  active: SessionActiveOutput,
) {
  Object.keys(session.data.session_status)
    .filter((sessionID) => active[sessionID] === undefined && session.data.session_status[sessionID]?.type !== "idle")
    .forEach((sessionID) => session.set("session_status", sessionID, { type: "idle" }))
  Object.keys(active).forEach((sessionID) => session.set("session_status", sessionID, { type: "busy" }))
}

function makeQueryOptionsApi(scope: ServerScope, serverAPI: ServerApi) {
  return {
    globalConfig: () => loadGlobalConfigQuery(scope),
    projects: () => loadProjectsQuery(scope, serverAPI.project),
    providers: (directory: PathKey | null) => loadProvidersQuery(scope, directory, serverAPI),
    integrations: (directory: PathKey | null) => loadIntegrationsQuery(scope, directory, serverAPI.integration),
    path: (directory: PathKey | null) => loadPathQuery(scope, directory, serverAPI.location),
    agents: (directory: PathKey) => loadAgentsQuery(scope, directory, serverAPI.agent),
    references: (directory: PathKey) => loadReferencesQuery(scope, directory, serverAPI.reference),
    mcp: (directory: PathKey) => loadMcpQuery(scope, directory, serverAPI.mcp),
    mcpResources: (directory: PathKey) => loadMcpResourcesQuery(scope, directory, serverAPI.mcp),
    lsp: (directory: PathKey) => loadLspQuery(scope, directory),
    sessions: (directory: PathKey) => ({ queryKey: [scope, directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

export function createServerSyncContextInner(serverSDK: ServerSDK) {
  const language = useLanguage()
  const platform = usePlatform()
  const owner = getOwner()
  if (!owner) throw new Error("ServerSync must be created within owner")

  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()
  const sessionRevision = new Map<string, number>()

  const session = createServerSession(serverSDK.api.session, serverSDK.api.message)
  const queryOptionsApi = makeQueryOptionsApi(serverSDK.scope, serverSDK.api)
  const connected = () => serverSDK.connection.status() === "connected"
  const hydrateSessionState = async (sessionID: string) => {
    await session.hydrateTransient(sessionID, async () => {
      const [pending, forms] = await Promise.all([
        serverSDK.api.session.inbox.list({ sessionID }),
        serverSDK.api.form.list({ sessionID }),
      ])
      return { pending, forms }
    })
  }
  const hydrateSession = (sessionID: string) => Promise.all([session.sync(sessionID), hydrateSessionState(sessionID)])

  const [configQuery, providerQuery, pathQuery] = useQueries(() => ({
    queries: [
      { ...queryOptionsApi.globalConfig(), enabled: connected() },
      { ...queryOptionsApi.providers(null), enabled: connected() },
      { ...queryOptionsApi.path(null), enabled: connected() },
    ],
  }))
  const activeSessionsQuery = useQuery(() => ({
    ...loadActiveSessionsQuery(serverSDK.scope, {
      active: async () => {
        const active = await serverSDK.api.session.active()
        reconcileActiveSessionStatuses(session, active)
        Object.keys(active).forEach((sessionID) => {
          void Promise.all([session.resolve(sessionID), hydrateSessionState(sessionID)]).catch(() => undefined)
        })
        return active
      },
    }),
    enabled: connected(),
  }))

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return bootstrap.isSuccess
    },
    project: [],
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
  const homeSessions = createHomeSessionIndexCache(queryClient, ServerConnection.key(serverSDK.server))
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
    queryKey: [serverSDK.scope, "bootstrap"],
    queryFn: async () => {
      await bootstrapGlobal({
        serverAPI: serverSDK.api,
        scope: serverSDK.scope,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      return Date.now()
    },
    enabled: connected(),
  }))

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: [serverSDK.scope, "bootstrap"] }),
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    connected,
    scope: serverSDK.scope,
    persist: persisted,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      if (!connected()) return
      void bootstrapInstance(directory)
    },
    onMcp: (directory, setStore) => {
      void loadCommands(directory, serverSDK.api.command)
        .then((commands) => setStore("command", commands))
        .catch((err) => {
          showToast({
            variant: "error",
            title: language.t("toast.project.reloadFailed.title", { project: getFilename(directory) }),
            description: formatServerError(err, language.t),
          })
        })
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      clearProviderRev(serverSDK.scope, key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      get provider() {
        return globalStore.provider
      },
    },
  })
  const catalog = createCatalogSync({
    scope: serverSDK.scope,
    queryClient,
    active: () => Object.keys(children.children).filter(children.active).map(pathKey),
    load: (directory) =>
      Promise.all([
        queryClient.fetchQuery(queryOptionsApi.providers(directory)),
        queryClient.fetchQuery(queryOptionsApi.integrations(directory)),
      ]).then(() => undefined),
  })
  const refreshVcs = (directory: string) =>
    serverSDK.api.vcs
      .get({ location: { directory } })
      .then((result) =>
        children.vcs(directory, {
          branch: result.data.branch.current,
          default_branch: result.data.branch.default,
        }),
      )
      .catch(() => undefined)
  const connection = createConnectionSync({
    status: serverSDK.connection.status,
    invalidate: () => {
      session.invalidate()
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === serverSDK.scope,
        refetchType: "none",
      })
    },
    connected: (info) => {
      if (info.reconnect) void session.refreshPinned(hydrateSessionState).catch(() => undefined)
      if (activeSessionsQuery.data !== undefined && !activeSessionsQuery.isFetching) void activeSessionsQuery.refetch()
      if (bootstrap.data !== undefined && !bootstrap.isFetching) void bootstrap.refetch()
      Object.keys(children.children)
        .filter(children.active)
        .forEach((directory) => {
          queue.push(directory)
          if (children.children[directory]?.[0].status !== "loading") void refreshVcs(directory)
        })
    },
  })

  async function loadCurrentSessions(directory: string, key: PathKey, limit: number) {
    while (true) {
      const revision = sessionRevision.get(key) ?? 0
      const result = await loadRootSessions({ api: serverSDK.api.session, directory, limit })
      if ((sessionRevision.get(key) ?? 0) === revision) return result
    }
  }

  async function loadSessions(directory: string, options?: { limit?: number }) {
    const key = directoryKey(directory)
    const pending = sessionLoads.get(key)
    if (pending) {
      await pending
      return loadSessions(directory, options)
    }

    children.pin(key)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const meta = sessionMeta.get(key)
    const retainedLimit = Math.max(store.limit, options?.limit ?? 0, meta?.limit ?? 0)
    if (meta && meta.limit >= retainedLimit) {
      const next = trimSessions(store.session, {
        limit: retainedLimit,
        permission: session.data.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
      }
      children.unpin(key)
      return
    }

    const limit = Math.max(retainedLimit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = queryClient
      .fetchQuery({
        ...queryOptionsApi.sessions(key),
        queryFn: () =>
          loadCurrentSessions(directory, key, limit)
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              const limit = Math.max(store.limit, options?.limit ?? 0, sessionMeta.get(key)?.limit ?? 0)
              const childSessions = store.session.filter((s) => !!s.parentID)
              const next = trimSessions([...nonArchived, ...childSessions], {
                limit,
                permission: session.data.permission,
              })
              batch(() => {
                next.forEach(session.remember)
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(next, { key: "id" }))
              })
              sessionMeta.set(key, { limit })
            })
            .catch((err) => {
              console.error("Failed to load sessions", err)
              const project = getFilename(directory)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatServerError(err, language.t),
              })
            })
            .then(() => null),
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
      const initial = child[0].status === "loading"
      await Promise.all([
        bootstrapDirectory({
          directory,
          scope: serverSDK.scope,
          mcp: children.mcp(key),
          global: {
            config: globalStore.config,
            path: globalStore.path,
            project: globalStore.project,
            provider: globalStore.provider,
          },
          api: serverSDK.api,
          store: child[0],
          setStore: child[1],
          loadSessions,
          translate: language.t,
          queryClient,
          session,
        }),
        initial ? refreshVcs(directory) : Promise.resolve(),
      ])
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  const indexSession = (info: Parameters<typeof session.remember>[0]) => {
    const key = directoryKey(info.location.directory)
    const existing = children.children[key]
    if (!existing) return
    applyDirectoryEvent({
      event: { type: "session.created", properties: { info } },
      directory: key,
      store: existing[0],
      setStore: existing[1],
      push: queue.push,
      retainedLimit: sessionMeta.get(key)?.limit,
      sessionContent: false,
      permission: session.data.permission,
      loadLsp() {},
    })
  }
  const updateHomeSession = (info: Parameters<typeof session.remember>[0]) =>
    homeSessions.apply({
      type: "session.updated",
      properties: { sessionID: info.id, info },
    })
  const markSessionListChanged = (event: ServerEvent, directory: string, previousDirectory?: string) => {
    if (SESSION_LIST_EVENTS.has(event.current?.type ?? event.type)) {
      const key = directoryKey(directory)
      sessionRevision.set(key, (sessionRevision.get(key) ?? 0) + 1)
    }
    if (!previousDirectory || previousDirectory === directory) return
    const key = directoryKey(previousDirectory)
    sessionRevision.set(key, (sessionRevision.get(key) ?? 0) + 1)
  }
  const toDirectoryEvent = (event: ServerEvent) => {
    if (event.current?.type === "session.created") return
    if (
      event.current?.type !== "session.renamed" &&
      event.current?.type !== "session.moved" &&
      event.current?.type !== "session.usage.updated"
    )
      return event
    const info = session.get(event.current.data.sessionID)
    if (info) return { type: "session.updated", properties: { info } }
    return event
  }

  const unsub = serverSDK.event.listen((e) => {
    const directory = e.name
    const key = directoryKey(directory)
    const event = e.details
    const eventType: string = event.type
    const previousDirectory =
      event.current?.type === "session.moved"
        ? session.get(event.current.data.sessionID)?.location.directory
        : undefined
    markSessionListChanged(event, directory, previousDirectory)
    if (event.current) session.applyV2(event.current)
    session.apply(event)
    if (event.current?.type === "session.created")
      void session
        .resolve(event.current.data.sessionID, { force: true })
        .then((info) => {
          if (!session.get(info.id)) return
          indexSession(info)
          homeSessions.apply({
            type: "session.created",
            properties: { sessionID: info.id, info },
          })
        })
        .catch(() => {})
    if (event.current?.type === "session.deleted")
      homeSessions.apply({
        type: "session.deleted",
        properties: { sessionID: event.current.data.sessionID },
      })
    if (event.type === "session.created" || event.type === "session.deleted") {
      if ("info" in event.properties) homeSessions.apply(event as Parameters<typeof homeSessions.apply>[0])
    }
    if (
      event.current?.type === "session.renamed" ||
      event.current?.type === "session.moved" ||
      event.current?.type === "session.usage.updated"
    ) {
      const sessionID = event.current.data.sessionID
      const info = session.get(sessionID)
      if (info) updateHomeSession(info)
      if (!info)
        void session
          .resolve(sessionID)
          .then(() => {
            const current = session.get(sessionID)
            if (current) updateHomeSession(current)
          })
          .catch(() => undefined)
    }
    homeSessions.refresh(event.type)
    catalog.handleEvent({ type: eventType, directory })
    connection.handleEvent({ type: eventType, directory })

    if (directory === "global") {
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => void bootstrap.refetch(),
        setGlobalProject: setProjects,
      })
      if (
        eventType === "config.updated" ||
        eventType === "agent.updated" ||
        eventType === "worktree.updated"
      )
        bootstrap.refetch()
      if (eventType === "global.disposed") Object.keys(children.children).filter(children.active).forEach(queue.push)
      return
    }

    if (event.current?.type === "session.moved") {
      const info = session.get(event.current.data.sessionID)
      if (info) indexSession(info)
    }
    if (event.current?.type === "session.forked")
      void session
        .resolve(event.current.data.sessionID, { force: true })
        .then(indexSession)
        .catch(() => {})

    const existing = children.children[key]
    if (!existing) return
    children.mark(key)
    if (
      event.current?.type === "session.moved" ||
      // event.current?.type === "session.archived" ||
      event.current?.type === "session.forked" ||
      eventType === "config.updated" ||
      eventType === "agent.updated"
    )
      queue.push(key)
    if (eventType === "mcp.status.changed") void queryClient.invalidateQueries(queryOptionsApi.mcp(key))
    if (eventType === "mcp.resources.changed") void queryClient.invalidateQueries(queryOptionsApi.mcpResources(key))
    const [store, setStore] = existing
    if (eventType === "agent.updated")
      void queryClient
        .fetchQuery(queryOptionsApi.agents(key))
        .then((data) => setStore("agent", data))
        .catch(() => {})
    if (eventType === "command.updated")
      void loadCommands(directory, serverSDK.api.command)
        .then((commands) => setStore("command", commands))
        .catch(() => {})
    if (eventType === "worktree.updated") void bootstrap.refetch()
    const projected = toDirectoryEvent(event)
    if (projected)
      applyDirectoryEvent({
        event: projected,
        directory,
        store,
        setStore,
        push: (directory) => {
          if (children.active(directory)) queue.push(directory)
        },
        retainedLimit: sessionMeta.get(key)?.limit,
        sessionContent: false,
        permission: session.data.permission,
        vcsCache: children.vcsCache.get(key),
        loadLsp: () => {
          if (!children.active(key)) return
          void queryClient.fetchQuery(queryOptionsApi.lsp(key))
        },
        loadReferences: () => {
          if (!children.active(key)) return
          void queryClient.fetchQuery(queryOptionsApi.references(key))
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
    mutationFn: async (config: Config) => {
      // TODO: Restore config updates when the V2 client exposes a config API.
      // await serverSDK.api.config.update({ config })
      throw new Error(`Config updates are unavailable: ${Object.keys(config).length} fields were not saved`)
    },
    onSuccess: () => {
      bootstrap.refetch()
      // Invalidate all provider queries so newly configured custom providers
      // appear immediately in the available provider list across all directories.
      queryClient.invalidateQueries({ queryKey: [serverSDK.scope, null, "providers"] })
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === serverSDK.scope && query.queryKey[2] === "providers",
      })
    },
  }))

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    disableMcp: children.disableMcp,
    queryOptions: queryOptionsApi,
    refreshProviders: catalog.refreshActive,
    // bootstrap,
    updateConfig: updateConfigMutation.mutateAsync,
    project: projectApi,
    session: Object.assign(session, { hydrate: hydrateSession }),
    homeSessions,
    mcp: {
      toggle: async (directory: string, name: string) => {
        const key = directoryKey(directory)
        const status = children.child(key, { bootstrap: false })[0].mcp[name]?.status
        if (!status) return
        await toggleMcp({
          status,
          connect: async () => {
            await serverSDK.api.mcp.connect({ server: name, location: { directory: key } })
          },
          disconnect: async () => {
            await serverSDK.api.mcp.disconnect({ server: name, location: { directory: key } })
          },
          authenticate: async () => {
            const server = (await serverSDK.api.mcp.list({ location: { directory: key } })).data.find(
              (item) => item.name === name,
            )
            if (!server?.integrationID) throw new Error(`MCP server ${name} has no authentication integration`)
            const integration = await serverSDK.api.integration.get({
              integrationID: server.integrationID,
              location: { directory: key },
            })
            const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)
            if (!method || method.type !== "oauth")
              throw new Error(`MCP server ${name} requires an interactive authentication form`)
            const attempt = await serverSDK.api.integration.oauth.connect({
              integrationID: server.integrationID,
              methodID: method.id,
              location: { directory: key },
            })
            platform.openExternal(attempt.data.url)
          },
          refresh: async () => {
            await queryClient.refetchQueries(queryOptionsApi.mcp(key))
            await queryClient.refetchQueries(queryOptionsApi.mcpResources(key))
          },
        })
      },
    },
  }
}

export function createServerSyncContext(serverSDK: ServerSDK) {
  const inner = createServerSyncContextInner(serverSDK)
  return Object.assign(inner, {
    ensureDirSyncContext: createRefCountMap(
      (dir) => createDirSyncContext(dir, inner, serverSDK),
      (dir) => inner.disableMcp(dir),
      directoryKey,
    ),
  })
}

export type ServerSync = ReturnType<typeof createServerSyncContext>

export const { use: useServerSync, provider: ServerSyncProvider } = createSimpleContext({
  name: "ServerSync",
  // Returns an accessor so the resolved server can change reactively without
  // re-instantiating the subtree (mirrors useServerSDK).
  init: (props: { server?: ServerConnection.Any }) => {
    const global = useGlobal()
    const language = useLanguage()
    const server = useServer()

    return createMemo<ServerSync>(() => {
      const conn = props.server ?? server.current
      if (!conn) throw new Error(language.t("error.serverSDK.noServerAvailable"))
      return global.ensureServerCtx(conn).sync
    })
  },
})

export function useQueryOptions() {
  const sync = useServerSync()
  return createMemo(() => sync().queryOptions)
}
