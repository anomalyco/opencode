import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, batch, createMemo } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { pathKey } from "@/utils/path-key"
import { ServerScope } from "@/utils/server-scope"

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
type ServerProjectState = {
  projects: Record<string, StoredProject[]>
  lastProject: Record<string, string>
  recentlyClosed: Record<string, string[]>
  hiddenClosed?: Record<string, string[]>
  archivedClosed?: Record<string, string[]>
}
const HEALTH_POLL_INTERVAL_MS = 10_000
// The store retains more history than is displayed. Consumers filter recently closed entries
// against the live project list (dropping deleted projects) and then cap the visible count via
// RECENTLY_CLOSED_DISPLAY_LIMIT. Retaining extra history ensures entries that are temporarily
// filtered out do not evict still-visible ones from the persisted store.
//
// Hidden and archived are subsets of recentlyClosed history, stored as raw worktree strings
// and matched via pathKey. They are pruned whenever they fall out of the history window.
export const RECENTLY_CLOSED_HISTORY_LIMIT = 50
export const RECENTLY_CLOSED_DISPLAY_LIMIT = 5

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function migrateCanonicalLocalServerState(value: unknown, canonicalLocalServer?: ServerConnection.Key) {
  if (!canonicalLocalServer || canonicalLocalServer === "local") return value
  if (!isRecord(value)) return value
  const projects = isRecord(value.projects) ? value.projects : undefined
  const lastProject = isRecord(value.lastProject) ? value.lastProject : undefined
  const recentlyClosed = isRecord(value.recentlyClosed) ? (value.recentlyClosed as Record<string, unknown>) : undefined
  const hiddenClosed = isRecord(value.hiddenClosed) ? (value.hiddenClosed as Record<string, unknown>) : undefined
  const archivedClosed = isRecord(value.archivedClosed)
    ? (value.archivedClosed as Record<string, unknown>)
    : undefined
  const previousProjects = projects?.[canonicalLocalServer]
  const previousLastProject = lastProject?.[canonicalLocalServer]
  const previousClosed = recentlyClosed?.[canonicalLocalServer]
  const previousHidden = hiddenClosed?.[canonicalLocalServer]
  const previousArchived = archivedClosed?.[canonicalLocalServer]
  if (
    !Array.isArray(previousProjects) &&
    typeof previousLastProject !== "string" &&
    !Array.isArray(previousClosed) &&
    !Array.isArray(previousHidden) &&
    !Array.isArray(previousArchived)
  )
    return value

  const next = { ...value }
  if (projects && Array.isArray(previousProjects)) {
    const local = Array.isArray(projects.local) ? projects.local : []
    const worktrees = new Set(
      local.flatMap((project) => (isRecord(project) && typeof project.worktree === "string" ? [project.worktree] : [])),
    )
    const migrated = previousProjects.filter((project) => {
      if (!isRecord(project) || typeof project.worktree !== "string") return true
      if (worktrees.has(project.worktree)) return false
      worktrees.add(project.worktree)
      return true
    })
    const nextProjects: Record<string, unknown> = { ...projects, local: [...local, ...migrated] }
    delete nextProjects[canonicalLocalServer]
    next.projects = nextProjects
  }
  if (lastProject && typeof previousLastProject === "string") {
    const nextLastProject = { ...lastProject }
    if (typeof nextLastProject.local !== "string") nextLastProject.local = previousLastProject
    delete nextLastProject[canonicalLocalServer]
    next.lastProject = nextLastProject
  }
  const mergeStringList = (current: unknown, previous: unknown) => {
    if (!Array.isArray(previous)) return undefined
    const local = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : []
    const seen = new Set(local.map((item) => pathKey(item)))
    const migrated = (previous as unknown[]).filter((item) => {
      if (typeof item !== "string") return true
      const key = pathKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return [...local, ...migrated]
  }
  if (recentlyClosed && Array.isArray(previousClosed)) {
    const merged = mergeStringList(recentlyClosed.local, previousClosed)
    if (merged) {
      const nextClosed: Record<string, unknown> = { ...recentlyClosed, local: merged }
      delete nextClosed[canonicalLocalServer]
      next.recentlyClosed = nextClosed
    }
  }
  if (hiddenClosed && Array.isArray(previousHidden)) {
    const merged = mergeStringList(hiddenClosed.local, previousHidden)
    if (merged) {
      const nextHidden: Record<string, unknown> = { ...hiddenClosed, local: merged }
      delete nextHidden[canonicalLocalServer]
      next.hiddenClosed = nextHidden
    }
  }
  if (archivedClosed && Array.isArray(previousArchived)) {
    const merged = mergeStringList(archivedClosed.local, previousArchived)
    if (merged) {
      const nextArchived: Record<string, unknown> = { ...archivedClosed, local: merged }
      delete nextArchived[canonicalLocalServer]
      next.archivedClosed = nextArchived
    }
  }
  return next
}

export function createServerProjects<T extends ServerProjectState>(input: {
  scope: Accessor<ServerScope>
  store: Store<T>
  setStore: SetStoreFunction<T>
}) {
  const setStore = input.setStore as unknown as SetStoreFunction<ServerProjectState>
  const current = () => input.store.projects[input.scope()] ?? []
  const currentClosed = () => input.store.recentlyClosed?.[input.scope()] ?? []
  const currentHidden = () => input.store.hiddenClosed?.[input.scope()] ?? []
  const currentArchived = () => input.store.archivedClosed?.[input.scope()] ?? []
  const remove = (directory: string) => {
    setStore(
      "projects",
      input.scope(),
      current().filter((project) => project.worktree !== directory),
    )
  }
  const containsKey = (items: string[], directory: string) => {
    const key = pathKey(directory)
    return items.some((worktree) => pathKey(worktree) === key)
  }
  const withoutKey = (items: string[], directory: string) => {
    const key = pathKey(directory)
    return items.filter((worktree) => pathKey(worktree) !== key)
  }
  const pruneMeta = (closed: string[], scope: string) => {
    const keys = new Set(closed.map((worktree) => pathKey(worktree)))
    const hidden = (input.store.hiddenClosed?.[scope] ?? []).filter((worktree) => keys.has(pathKey(worktree)))
    const archived = (input.store.archivedClosed?.[scope] ?? []).filter((worktree) => keys.has(pathKey(worktree)))
    setStore("hiddenClosed", scope, hidden)
    setStore("archivedClosed", scope, archived)
  }
  const clearMetaFor = (scope: string, directory: string) => {
    const key = pathKey(directory)
    const hidden = currentHidden()
    const archived = currentArchived()
    if (hidden.some((worktree) => pathKey(worktree) === key)) {
      setStore(
        "hiddenClosed",
        scope,
        hidden.filter((worktree) => pathKey(worktree) !== key),
      )
    }
    if (archived.some((worktree) => pathKey(worktree) === key)) {
      setStore(
        "archivedClosed",
        scope,
        archived.filter((worktree) => pathKey(worktree) !== key),
      )
    }
  }
  return {
    list: current,
    recentlyClosed: currentClosed,
    hiddenClosed: currentHidden,
    archivedClosed: currentArchived,
    isHiddenClosed: (directory: string) => containsKey(currentHidden(), directory),
    isArchivedClosed: (directory: string) => containsKey(currentArchived(), directory),
    remove,
    open(directory: string) {
      const scope = input.scope()
      const key = pathKey(directory)
      const closed = currentClosed()
      if (closed.some((worktree) => pathKey(worktree) === key)) {
        const next = closed.filter((worktree) => pathKey(worktree) !== key)
        setStore("recentlyClosed", scope, next)
        pruneMeta(next, scope)
      } else {
        clearMetaFor(scope, directory)
      }
      if (current().some((project) => project.worktree === directory)) return
      setStore("projects", scope, [{ worktree: directory, expanded: true }, ...current()])
    },
    // User-initiated close: removes the project and records it in recently closed.
    // Internal, non-user removals (e.g. sandbox/worktree normalization) should use remove().
    // Re-closing a project makes it visible again: hidden/archived flags are cleared.
    close(directory: string) {
      const scope = input.scope()
      remove(directory)
      clearMetaFor(scope, directory)
      const key = pathKey(directory)
      const closed = [directory, ...currentClosed().filter((worktree) => pathKey(worktree) !== key)].slice(
        0,
        RECENTLY_CLOSED_HISTORY_LIMIT,
      )
      setStore("recentlyClosed", scope, closed)
      pruneMeta(closed, scope)
    },
    hideClosed(directory: string) {
      const scope = input.scope()
      if (!containsKey(currentClosed(), directory)) return
      if (containsKey(currentHidden(), directory)) return
      setStore("hiddenClosed", scope, [...currentHidden(), directory])
    },
    unhideClosed(directory: string) {
      const scope = input.scope()
      if (!containsKey(currentHidden(), directory)) return
      setStore("hiddenClosed", scope, withoutKey(currentHidden(), directory))
    },
    archiveClosed(directory: string) {
      const scope = input.scope()
      if (!containsKey(currentClosed(), directory)) return
      if (containsKey(currentArchived(), directory)) return
      setStore("archivedClosed", scope, [...currentArchived(), directory])
    },
    unarchiveClosed(directory: string) {
      const scope = input.scope()
      if (!containsKey(currentArchived(), directory)) return
      setStore("archivedClosed", scope, withoutKey(currentArchived(), directory))
    },
    // Forget a closed entry entirely. This only removes local history; it never deletes files.
    removeClosed(directory: string) {
      const scope = input.scope()
      const key = pathKey(directory)
      const closed = currentClosed()
      if (!closed.some((worktree) => pathKey(worktree) === key)) {
        clearMetaFor(scope, directory)
        return
      }
      const next = closed.filter((worktree) => pathKey(worktree) !== key)
      setStore("recentlyClosed", scope, next)
      pruneMeta(next, scope)
    },
    clearClosed() {
      const scope = input.scope()
      setStore("recentlyClosed", scope, [])
      setStore("hiddenClosed", scope, [])
      setStore("archivedClosed", scope, [])
    },
    moveClosed(directory: string, toIndex: number) {
      const scope = input.scope()
      const closed = currentClosed()
      const fromIndex = closed.findIndex((worktree) => pathKey(worktree) === pathKey(directory))
      if (fromIndex === -1 || fromIndex === toIndex) return
      const clamped = Math.max(0, Math.min(toIndex, closed.length - 1))
      if (fromIndex === clamped) return
      const next = [...closed]
      const [item] = next.splice(fromIndex, 1)
      next.splice(clamped, 0, item)
      setStore("recentlyClosed", scope, next)
    },
    expand(directory: string) {
      const index = current().findIndex((project) => project.worktree === directory)
      if (index !== -1) setStore("projects", input.scope(), index, "expanded", true)
    },
    collapse(directory: string) {
      const index = current().findIndex((project) => project.worktree === directory)
      if (index !== -1) setStore("projects", input.scope(), index, "expanded", false)
    },
    move(directory: string, toIndex: number) {
      const fromIndex = current().findIndex((project) => project.worktree === directory)
      if (fromIndex === -1 || fromIndex === toIndex) return
      const next = [...current()]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      setStore("projects", input.scope(), next)
    },
    last() {
      return input.store.lastProject[input.scope()]
    },
    touch(directory: string) {
      setStore("lastProject", input.scope(), directory)
    },
  }
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: StoredServer[]
}): Array<ServerConnection.Any> {
  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>(
    input.props?.map((v) => [ServerConnection.key(v), v]) ?? [],
  )

  for (const value of input.stored) {
    const conn: ServerConnection.Http =
      typeof value === "string"
        ? {
            type: "http" as const,
            http: { url: value },
          }
        : "http" in value
          ? value
          : { type: "http", http: value }
    const key = ServerConnection.key(conn)

    const existing = deduped.get(key)
    if (existing)
      deduped.set(key, {
        ...existing,
        ...conn,
        http: { ...existing.http, ...conn.http },
      })
    else deduped.set(key, conn)
  }

  return [...deduped.values()]
}

export namespace ServerConnection {
  type Base = { displayName?: string; label?: string }

  export type HttpBase = {
    url: string
    username?: string
    password?: string
  }

  // Regular web connections
  export type Http = {
    type: "http"
    http: HttpBase
    authToken?: boolean
  } & Base

  export type Sidecar = {
    type: "sidecar"
    http: HttpBase
  } & (
    | // Regular desktop server
    { variant: "base" }
    // WSL server (windows only)
    | {
        variant: "wsl"
        distro: string
      }
  ) &
    Base

  // Remote server desktop can SSH into
  export type Ssh = {
    type: "ssh"
    host: string
    // SSH client exposes an HTTP server for the app to use as a proxy
    http: HttpBase
  } & Base

  export type Any =
    | Http
    // All these are desktop-only
    | (Sidecar | Ssh)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar": {
        if (conn.variant === "wsl") return Key.make(`wsl:${conn.distro}`)
        return Key.make("sidecar")
      }
      case "ssh":
        return Key.make(`ssh:${conn.host}`)
    }
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }

  export const builtin = (conn: Any) => conn.type === "sidecar" && conn.variant === "base"
  export const local = (conn?: Any) =>
    !!conn && (builtin(conn) || (conn.type === "http" && isLocalHost(conn.http.url) === "local"))
}

export function nextServerAfterRemoval(
  servers: ServerConnection.Any[],
  removed: ServerConnection.Key,
  fallback: ServerConnection.Key,
) {
  const remaining = servers.filter((server) => ServerConnection.key(server) !== removed)
  const next = remaining.find((server) => ServerConnection.key(server) === fallback) ?? remaining[0]
  return next ? ServerConnection.key(next) : fallback
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  gate: true,
  init: (props: {
    defaultServer: ServerConnection.Key
    canonicalLocalServer?: ServerConnection.Key
    servers?: Array<ServerConnection.Any>
  }) => {
    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.global("server", ["server.v3"]),
        migrate: (value) => migrateCanonicalLocalServerState(value, props.canonicalLocalServer),
      },
      createStore({
        list: [] as StoredServer[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        recentlyClosed: {} as Record<string, string[]>,
        hiddenClosed: {} as Record<string, string[]>,
        archivedClosed: {} as Record<string, string[]>,
      }),
    )

    const url = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      return resolveServerList({ stored: store.list, props: props.servers })
    })

    const [state, setState] = createStore({
      active: props.defaultServer,
    })

    function setActive(input: ServerConnection.Key) {
      if (state.active !== input) setState("active", input)
    }

    function add(input: ServerConnection.Http) {
      const url_ = normalizeServerUrl(input.http.url)
      if (!url_) return
      const conn: ServerConnection.Http = { ...input, authToken: undefined, http: { ...input.http, url: url_ } }
      return batch(() => {
        const existing = store.list.findIndex((x) => url(x) === url_)
        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }
        setState("active", ServerConnection.key(conn))
        return conn
      })
    }

    function remove(key: ServerConnection.Key) {
      const next = nextServerAfterRemoval(allServers(), key, props.defaultServer)
      const list = store.list.filter((x) => url(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) setState("active", next)
      })
    }

    const isReady = Object.assign(
      createMemo(() => ready() && !!state.active),
      { promise: ready.promise },
    )

    const scope = (key = state.active) => ServerScope.fromServerKey(key, props.canonicalLocalServer)
    const projects = createServerProjects({ scope, store, setStore })
    const projectStores = new Map<ServerConnection.Key, ReturnType<typeof createServerProjects>>()
    const projectsForServer = (key: ServerConnection.Key) => {
      const existing = projectStores.get(key)
      if (existing) return existing
      const next = createServerProjects({ scope: () => scope(key), store, setStore })
      projectStores.set(key, next)
      return next
    }
    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () => allServers().find((s) => ServerConnection.key(s) === state.active) ?? allServers()[0],
    )
    const isLocal = createMemo(() => ServerConnection.local(current()))

    return {
      ready: isReady,
      isLocal,
      get key() {
        return state.active
      },
      get name() {
        return serverName(current())
      },
      get list() {
        return allServers()
      },
      get current() {
        return current()
      },
      setActive,
      add,
      remove,
      scope,
      projects: {
        ...projects,
        forServer: projectsForServer,
      },
    }
  },
})
