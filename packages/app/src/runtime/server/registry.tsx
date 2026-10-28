import { createSimpleContext } from "@opencode/ui/context"
import { useLanguage } from "@/runtime/i18n/language"
import { batch, createMemo } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerScope } from "@/runtime/server/scope"
import type { ServerEntry } from "@opencode/plugin/gui"
import { ServerHttp, ServerHttpBase, ServerKey, ServerState } from "./persistence"

type StoredState = typeof ServerState.Type

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

/**
 * What switchers and titles call a server: a custom name wins, then, for the server the app runs beside, its
 * hostname or the fallback; other servers show their address.
 */
export function serverLabel(conn: ServerConnection.Any, current?: { hostname?: string; fallback: string }) {
  if (conn.displayName) return conn.displayName

  if (current) return current.hostname || current.fallback

  return serverName(conn)
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]

  if (host === "localhost" || host === "127.0.0.1") return "local"
}

// Project data comes from the server; this keeps which projects this client has used and the last one.
export function createServerProjects(input: {
  scope: () => ServerScope
  store: Store<StoredState>
  setStore: SetStoreFunction<StoredState>
}) {
  const used = () => input.store.usedProjectIDs[input.scope()] ?? []

  const use = (projectIDs: string[]) => {
    const current = used()
    const next = [...new Set([...current, ...projectIDs])]

    if (next.length !== current.length) input.setStore("usedProjectIDs", input.scope(), next)
  }

  return {
    last() {
      return input.store.lastProjectID[input.scope()]
    },
    touch(projectID: string) {
      batch(() => {
        input.setStore("lastProjectID", input.scope(), projectID)
        use([projectID])
      })
    },
    used,
    use,
    hide(projectIDs: string[]) {
      input.setStore(
        "usedProjectIDs",
        input.scope(),
        used().filter((id) => !projectIDs.includes(id)),
      )
    },
    /** Directories an older build listed for this server, until `migrate` consumes them. */
    legacy() {
      return input.store.projects[input.scope()]?.map((project) => project.worktree)
    },
    migrate(projectIDs: string[]) {
      const scope = input.scope()
      batch(() => {
        use(projectIDs)
        input.setStore(
          "projects",
          reconcile(Object.fromEntries(Object.entries(input.store.projects).filter(([key]) => key !== scope))),
        )
      })
    },
  }
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: ServerConnection.Http[]
}): Array<ServerConnection.Any> {
  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>(
    input.props?.map((v) => [ServerConnection.key(v), v]) ?? [],
  )

  for (const conn of input.stored) {
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

export function canRemoveServer(input: {
  key: ServerConnection.Key
  provided?: Array<ServerConnection.Any>
  stored: ServerConnection.Http[]
}) {
  if (input.provided?.some((server) => ServerConnection.key(server) === input.key)) return false

  return input.stored.some((server) => server.http.url === input.key)
}

export namespace ServerConnection {
  type Base = { displayName?: string; label?: string }

  export type HttpBase = typeof ServerHttpBase.Type

  // Regular web connections
  export type Http = typeof ServerHttp.Type

  // Regular desktop server
  export type Sidecar = {
    type: "sidecar"
    variant: "base"
    http: HttpBase
    reconnect?: (signal: AbortSignal) => Promise<HttpBase>
  } & Base

  // A server a GUI plugin contributes (e.g. SSH or WSL), keyed `${plugin}:${id}`
  export type Plugin = {
    type: "plugin"
    key: string
    plugin: string
    state: ServerEntry["state"]
    connecting: boolean
    authenticationRequired: boolean
    /** The plugin re-resolves the endpoint (e.g. a tunnel), so the connection can drop and come back. */
    managed: boolean
    http: HttpBase
    reconnect?: (signal: AbortSignal) => Promise<HttpBase>
    /** Called before opening a server that is not ready. Resolves true once it is. */
    connect?: () => Promise<boolean>
  } & Base

  export type Any =
    | Http
    // All these are desktop-only
    | (Sidecar | Plugin)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar":
        return Key.make("sidecar")
      case "plugin":
        return Key.make(conn.key)
    }
  }

  export const Key = ServerKey
  export type Key = typeof Key.Type

  export const builtin = (conn: Any) => conn.type === "sidecar" && conn.variant === "base"
  /** Starts sign-in for a server that asks for it; false when it does not. */
  export const authenticate = (conn: Any, onConnected?: () => void) => {
    if (conn.type !== "plugin" || !conn.authenticationRequired || !conn.connect) return false
    void conn.connect().then((ready) => {
      if (ready) onConnected?.()
    })

    return true
  }

  export const local = (conn?: Any) =>
    !!conn && (builtin(conn) || (conn.type === "http" && isLocalHost(conn.http.url) === "local"))
}

export const { use: useServers, provider: ServersProvider } = createSimpleContext({
  name: "Server",
  gate: true,
  init: (props: { canonicalLocalServer?: ServerConnection.Key; servers?: Array<ServerConnection.Any> }) => {
    const [store, setStore, _, hydrated] = persisted(
      {
        ...Persist.global("server"),
        sync: true,
        previousKey: "server.v3",
      },
      ServerState,
      { list: [], hidden: {}, lastProjectID: {}, usedProjectIDs: {}, hostnames: {}, projects: {} },
    )

    const language = useLanguage()

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      return resolveServerList({ stored: store.list, props: props.servers })
    })

    const visibleServers = createMemo(() => allServers().filter((conn) => !store.hidden[ServerConnection.key(conn)]))

    function add(input: ServerConnection.Http) {
      const url_ = normalizeServerUrl(input.http.url)

      if (!url_) return
      const conn: ServerConnection.Http = { ...input, authToken: undefined, http: { ...input.http, url: url_ } }

      return batch(() => {
        const existing = store.list.findIndex((x) => x.http.url === url_)

        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }

        return conn
      })
    }

    function remove(key: ServerConnection.Key) {
      const list = store.list.filter((x) => x.http.url !== key)
      batch(() => {
        setStore("list", list)
      })
    }

    function canRemove(key: ServerConnection.Key) {
      return canRemoveServer({ key, provided: props.servers, stored: store.list })
    }

    const scope = (key: ServerConnection.Key) => ServerScope.fromServerKey(key, props.canonicalLocalServer)
    const projectStores = new Map<ServerConnection.Key, ReturnType<typeof createServerProjects>>()

    const projectsForServer = (key: ServerConnection.Key) => {
      const existing = projectStores.get(key)

      if (existing) return existing
      const next = createServerProjects({ scope: () => scope(key), store, setStore })
      projectStores.set(key, next)

      return next
    }

    // The desktop sidecar, or the server that served the web app.
    const current = (conn: ServerConnection.Any) =>
      ServerConnection.builtin(conn) || ServerConnection.key(conn) === props.canonicalLocalServer

    const label = (conn: ServerConnection.Any) =>
      serverLabel(
        conn,
        current(conn)
          ? { hostname: store.hostnames[ServerConnection.key(conn)], fallback: language.t("server.thisComputer") }
          : undefined,
      )

    return {
      get list() {
        return allServers()
      },
      get visible() {
        return visibleServers()
      },
      // Named to avoid the context `ready` gate: consumers that derive from persisted project
      // state wait on this, but the provider must not block first render on storage.
      hydrated,
      isHidden(key: ServerConnection.Key) {
        return store.hidden[key] ?? false
      },
      setHidden(key: ServerConnection.Key, hidden: boolean) {
        setStore("hidden", key, hidden)
      },
      add,
      remove,
      canRemove,
      scope,
      current,
      /** The name switchers, menus and titles show. */
      label,
      /** The name a list row shows next to its item: nothing for the current server or when it is the only one. */
      tag(conn: ServerConnection.Any) {
        return allServers().length < 2 || current(conn) ? undefined : label(conn)
      },
      /** "This computer" beside the current server's name, unless the name already says it. */
      hint(conn: ServerConnection.Any) {
        const text = language.t("server.thisComputer")

        return current(conn) && label(conn) !== text ? text : undefined
      },
      setHostname(key: ServerConnection.Key, hostname: string) {
        if (store.hostnames[key] !== hostname) setStore("hostnames", key, hostname)
      },
      projects: {
        forServer: projectsForServer,
      },
    }
  },
})
