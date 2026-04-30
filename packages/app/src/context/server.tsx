import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useCheckServerHealth } from "@/utils/server-health"
import {
  domainFromIntegration,
  isExtraAgentIntegration,
  mainDomain,
  type DomainId,
  type ExtraAgentId,
} from "@/pages/layout/extra-agents"

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
type StoredState = {
  list: StoredServer[]
  projects: Record<string, StoredProject[]>
  lastProject: Record<string, string>
  currentSidecarUrl?: string
}
const HEALTH_POLL_INTERVAL_MS = 10_000

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

function projectsKey(key: ServerConnection.Key) {
  if (!key) return ""
  if (key === "sidecar") return "local"
  if (isLocalHost(key)) return "local"
  return key
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: StoredServer[]
}): Array<ServerConnection.Any> {
  const servers = [
    ...input.stored.map((value) =>
      typeof value === "string"
        ? {
            type: "http" as const,
            http: { url: value },
          }
        : value,
    ),
    ...(input.props ?? []),
  ]

  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>()
  for (const value of servers) {
    const conn: ServerConnection.Any = "type" in value ? value : { type: "http", http: value }
    const key = ServerConnection.key(conn)
    if (deduped.has(key) && conn.type === "http" && !conn.authToken) continue
    deduped.set(key, conn)
  }

  return [...deduped.values()]
}

export namespace ServerConnection {
  type Base = { displayName?: string; integration?: ExtraAgentId }

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
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: {
    defaultServer: ServerConnection.Key
    disableHealthCheck?: boolean
    servers?: Array<ServerConnection.Any>
  }) => {
    const checkServerHealth = useCheckServerHealth()

    const [store, setStore, _, ready] = persisted(
      Persist.global("server", ["server.v3"]),
      createStore({
        list: [] as StoredServer[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        currentSidecarUrl: undefined as string | undefined,
      } satisfies StoredState),
    )

    const url = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      const sidecar = (props.servers ?? []).find((item) => item.type === "sidecar" && item.variant === "base")
      const legacy = store.currentSidecarUrl
      const servers = [
        ...(props.servers ?? []),
        ...store.list.flatMap((value) => {
          const conn =
            typeof value === "string"
              ? ({
                  type: "http" as const,
                  http: { url: value },
                } satisfies ServerConnection.Http)
              : "type" in value
                ? value
                : ({
                    type: "http" as const,
                    http: value,
                  } satisfies ServerConnection.Http)
          if (legacy && sidecar && conn.type === "http" && conn.http.url === legacy) return []
          return [conn]
        }),
      ]

      const deduped = new Map(
        servers.map((value) => {
          return [ServerConnection.key(value), value]
        }),
      )

      return [...deduped.values()]
    })

    const [state, setState] = createStore({
      active: props.defaultServer,
      lastNonExtraAgent: props.defaultServer,
      healthyByDomain: {} as Partial<Record<DomainId, boolean | undefined>>,
    })
    const trace = (_event: string, _extra?: Record<string, unknown>) => {}

    const healthyFor = (input: DomainId) => state.healthyByDomain[input]
    const healthy = () => healthyFor(domain())

    function startHealthPolling(conn: ServerConnection.Any, targetDomain: DomainId) {
      let alive = true
      let busy = false

      const run = () => {
        if (busy) return
        busy = true
        void check(conn)
          .then((next) => {
            if (!alive) return
            setState("healthyByDomain", targetDomain, next)
          })
          .finally(() => {
            busy = false
          })
      }

      run()
      const interval = setInterval(run, HEALTH_POLL_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(interval)
      }
    }

    function setActive(input: ServerConnection.Key) {
      trace("setActive", {
        from: state.active,
        to: input,
      })
      if (state.active !== input) setState("active", input)
    }

    function originFor(key: ServerConnection.Key) {
      const conn = allServers().find((item) => ServerConnection.key(item) === key)
      if (isExtraAgentIntegration(conn?.integration)) return conn.integration
      return projectsKey(key)
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
      const list = store.list.filter((x) => url(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) {
          const next = list[0]
          setState("active", next ? ServerConnection.Key.make(url(next)) : props.defaultServer)
        }
      })
    }

    const isReady = createMemo(() => ready() && !!state.active)

    const check = (conn: ServerConnection.Any) => checkServerHealth(conn.http).then((x) => x.healthy)

    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () => allServers().find((s) => ServerConnection.key(s) === state.active) ?? allServers()[0],
    )
    const domain = createMemo(() => domainFromIntegration(current()?.integration))

    const polls = new Map<ServerConnection.Key, { url: string; domain: DomainId; stop: () => void }>()

    createEffect(() => {
      const legacy = store.currentSidecarUrl
      if (!legacy) return
      console.debug("[server] removing legacy sidecar url from persisted server list", { legacy })
      setStore("list", (list) =>
        list.filter((value) => {
          const next = typeof value === "string" ? value : "type" in value ? value.http.url : value.url
          return next !== legacy
        }),
      )
      setStore("currentSidecarUrl", undefined)
    })

    createEffect(() => {
      const servers = allServers()
      const byKey = new Map<ServerConnection.Key, { conn: ServerConnection.Any; domain: DomainId }>()
      for (const conn of servers) {
        const key = ServerConnection.key(conn)
        byKey.set(key, { conn, domain: domainFromIntegration(conn.integration) })
      }

      for (const [key, { conn, domain: d }] of byKey) {
        const existing = polls.get(key)
        if (existing?.url === conn.http.url && existing.domain === d) continue
        existing?.stop()
        setState("healthyByDomain", d, undefined)
        const stop = startHealthPolling(conn, d)
        polls.set(key, { url: conn.http.url, domain: d, stop })
      }

      for (const [key, poll] of Array.from(polls.entries())) {
        if (byKey.has(key)) continue
        poll.stop()
        polls.delete(key)
      }

      const domainsAlive = new Set<DomainId>()
      for (const [, { domain: d }] of byKey) domainsAlive.add(d)
      const known = Object.keys(state.healthyByDomain) as DomainId[]
      const stale = known.filter((d) => !domainsAlive.has(d))
      if (stale.length > 0) {
        setState(
          "healthyByDomain",
          produce((draft) => {
            for (const d of stale) delete draft[d]
          }),
        )
      }
    })

    createEffect(() => {
      const current_ = current()
      if (!current_) return
      if (!isExtraAgentIntegration(current_.integration)) {
        setState("lastNonExtraAgent", ServerConnection.key(current_))
      }
    })

    onCleanup(() => {
      for (const poll of polls.values()) poll.stop()
      polls.clear()
    })

    const origin = createMemo(() => {
      const conn = current()
      if (isExtraAgentIntegration(conn?.integration)) return conn.integration
      return projectsKey(state.active)
    })
    const projectsList = createMemo(() => store.projects[origin()] ?? [])
    const projectsFor = (input?: ServerConnection.Key) => {
      const key = input ? originFor(input) : origin()
      if (!key) return [] as StoredProject[]
      return store.projects[key] ?? []
    }
    const isLocal = createMemo(() => {
      const c = current()
      return (c?.type === "sidecar" && c.variant === "base") || (c?.type === "http" && isLocalHost(c.http.url))
    })

    return {
      ready: isReady,
      healthy,
      healthyFor,
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
      get domain() {
        return domain()
      },
      domainFor(input?: ServerConnection.Key) {
        const conn = input ? allServers().find((item) => ServerConnection.key(item) === input) : current()
        return domainFromIntegration(conn?.integration)
      },
      currentFor(input: DomainId) {
        if (input === domain()) return current()
        if (input === mainDomain) return allServers().find((item) => !isExtraAgentIntegration(item.integration))
        const id = input.slice("extra-agent/".length)
        return allServers().find((item) => item.integration === id)
      },
      get lastNonExtraAgent() {
        const key = state.lastNonExtraAgent
        const conn = allServers().find((item) => ServerConnection.key(item) === key)
        if (!isExtraAgentIntegration(conn?.integration)) return key
        const fallback = allServers().find((item) => !isExtraAgentIntegration(item.integration))
        if (!fallback) return
        return ServerConnection.key(fallback)
      },
      lastFor(input: DomainId) {
        if (input === mainDomain) return this.lastNonExtraAgent
        const id = input.slice("extra-agent/".length)
        const conn = allServers().find((item) => item.integration === id)
        if (!conn) return
        return ServerConnection.key(conn)
      },
      setActive,
      add,
      remove,
      projects: {
        list: projectsList,
        listFor(input?: ServerConnection.Key) {
          return projectsFor(input)
        },
        open(directory: string) {
          const key = origin()
          if (!key) return
          const current = projectsFor()
          if (current.find((x) => x.worktree === directory)) return
          trace("projects.open", {
            key,
            directory,
            count: current.length,
          })
          setStore("projects", key, [{ worktree: directory, expanded: true }, ...current])
        },
        openFor(input: ServerConnection.Key | undefined, directory: string) {
          const key = input ? originFor(input) : origin()
          if (!key) return
          const current = projectsFor(input)
          if (current.find((x) => x.worktree === directory)) return
          setStore("projects", key, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          const key = origin()
          if (!key) return
          const current = projectsFor()
          setStore(
            "projects",
            key,
            current.filter((x) => x.worktree !== directory),
          )
        },
        closeFor(input: ServerConnection.Key | undefined, directory: string) {
          const key = input ? originFor(input) : origin()
          if (!key) return
          const current = projectsFor(input)
          setStore(
            "projects",
            key,
            current.filter((x) => x.worktree !== directory),
          )
        },
        expand(directory: string) {
          const key = origin()
          if (!key) return
          const current = projectsFor()
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", true)
        },
        expandFor(input: ServerConnection.Key | undefined, directory: string) {
          const key = input ? originFor(input) : origin()
          if (!key) return
          const current = projectsFor(input)
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", true)
        },
        collapse(directory: string) {
          const key = origin()
          if (!key) return
          const current = projectsFor()
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", false)
        },
        collapseFor(input: ServerConnection.Key | undefined, directory: string) {
          const key = input ? originFor(input) : origin()
          if (!key) return
          const current = projectsFor(input)
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", false)
        },
        move(directory: string, target: string) {
          const key = origin()
          if (!key) return
          const current = projectsFor()
          const fromIndex = current.findIndex((x) => x.worktree === directory)
          const toIndex = current.findIndex((x) => x.worktree === target)
          if (fromIndex === -1 || fromIndex === toIndex) return
          console.debug(
            `[project-dnd] move request directory=${directory} target=${target} from=${fromIndex} to=${toIndex} order=${current.map((item) => item.worktree).join(" | ")}`,
          )
          if (toIndex === -1) {
            console.debug(`[project-dnd] move target-missing directory=${directory} target=${target}`)
            return
          }
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          console.debug(`[project-dnd] move applied order=${result.map((item) => item.worktree).join(" | ")}`)
          setStore("projects", key, result)
        },
        moveFor(input: ServerConnection.Key | undefined, directory: string, toIndex: number) {
          const key = input ? originFor(input) : origin()
          if (!key) return
          const current = projectsFor(input)
          const fromIndex = current.findIndex((x) => x.worktree === directory)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", key, result)
        },
        last() {
          const key = origin()
          if (!key) return
          return store.lastProject[key]
        },
        lastFor(input: ServerConnection.Key) {
          const key = originFor(input)
          if (!key) return
          return store.lastProject[key]
        },
        touch(directory: string) {
          const key = origin()
          if (!key) return
          trace("projects.touch", {
            key,
            directory,
          })
          setStore("lastProject", key, directory)
        },
        touchFor(input: ServerConnection.Key | undefined, directory: string) {
          const key = input ? originFor(input) : origin()
          if (!key) return
          setStore("lastProject", key, directory)
        },
      },
    }
  },
})
