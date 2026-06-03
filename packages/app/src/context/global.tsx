import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerConnection, useServer } from "./server"
import { useServerHealth } from "@/utils/server-health"
import { QueryClient } from "@tanstack/solid-query"
import { createServerSdkContext } from "./server-sdk"
import { createServerSyncContext } from "./server-sync"
import { getOwner } from "solid-js/web"
import { Persist, persisted } from "@/utils/persist"

export const { use: useGlobal, provider: GlobalProvider } = createSimpleContext({
  name: "Global",
  init: (props: { defaultServer: ServerConnection.Key; servers?: Array<ServerConnection.Any> }) => {
    const server = useServer()
    const serverHealth = useServerHealth(
      () => server.list,
      () => true,
    )
    const [store, setStore] = createStore({
      settings: {
        serverKey: undefined as ServerConnection.Key | undefined,
      },
    })

    const serversAndProjects = createServersAndProjectStore()

    const settingsServer = createMemo(() => {
      const list = server.list
      return list.find((conn) => ServerConnection.key(conn) === store.settings.serverKey) ?? list[0]
    })

    createEffect(() => {
      const conn = settingsServer()
      const key = conn ? ServerConnection.key(conn) : undefined
      if (store.settings.serverKey !== key) setStore("settings", "serverKey", key)
    })

    const serverCtxs = new Map<
      ServerConnection.Key,
      { dispose: () => void; serverCtx: ReturnType<typeof createServerCtx> }
    >()

    const owner = getOwner()

    createMemo(() => {
      for (const conn of server.list) {
        const key = ServerConnection.key(conn)
        if (!serverCtxs.has(key)) {
          const root = createRoot((dispose) => {
            const serverCtx = createServerCtx(conn, serversAndProjects)
            return { dispose, serverCtx }
          }, owner as any)
          serverCtxs.set(key, root)
        }
      }

      for (const [key] of serverCtxs) {
        if (!server.list.find((conn) => ServerConnection.key(conn) === key)) {
          const { dispose } = serverCtxs.get(key)!
          dispose()
          serverCtxs.delete(key)
        }
      }
    })

    const allServers = createMemo(
      (): Array<ServerConnection.Any> =>
        resolveServerList({ stored: serversAndProjects.store.list, props: props.servers }),
    )

    return {
      servers: {
        list: allServers,
        health: serverHealth,
      },
      settings: {
        server: {
          get key() {
            return store.settings.serverKey
          },
          selected: settingsServer,
          set(key: ServerConnection.Key) {
            if (store.settings.serverKey !== key) setStore("settings", "serverKey", key)
          },
        },
      },
      createServerCtx(conn: ServerConnection.Any) {
        const key = ServerConnection.key(conn)
        const ctx = serverCtxs.get(key)
        if (!ctx) return createServerCtx(conn, serversAndProjects)
        return ctx.serverCtx
      },
    }
  },
})

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http

const createServersAndProjectStore = () => {
  const [store, setStore, _, ready] = persisted(
    Persist.global("server", ["server.v3"]),
    createStore({
      list: [] as StoredServer[],
      projects: {} as Record<string, StoredProject[]>,
      lastProject: {} as Record<string, string>,
    }),
  )
  return { store, setStore, ready }
}

function createServerCtx(
  conn: ServerConnection.Any,
  { store, setStore }: ReturnType<typeof createServersAndProjectStore>,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })

  const sdk = createServerSdkContext(conn)
  const sync = createServerSyncContext(sdk)

  const key = ServerConnection.key(conn)
  const storeKey = projectsKey(key)

  function enrich(project: { worktree: string; expanded: boolean }) {
    const [childStore] = sync.child(project.worktree, { bootstrap: false })
    const projectID = childStore.project
    const metadata = projectID
      ? sync.data.project.find((x) => x.id === projectID)
      : sync.data.project.find((x) => x.worktree === project.worktree)

    // Preserve local icon override from per-workspace localStorage cache (childStore.icon).
    // Without this, different subdirectories of the same git repo would share the same
    // icon from the database instead of using their individual overrides.
    const base = { ...metadata, ...project }
    if (childStore.icon) {
      return { ...base, icon: { ...base.icon, override: childStore.icon } }
    }
    return base
  }

  const projectsList = createMemo(() => (store.projects[storeKey] ?? []).map(enrich))

  const isLocal =
    (conn?.type === "sidecar" && conn.variant === "base") || (conn?.type === "http" && isLocalHost(conn.http.url))

  return {
    queryClient,
    sdk,
    sync,
    isLocal,
    projects: {
      list: projectsList,
      open(directory: string) {
        const current = store.projects[storeKey] ?? []
        if (current.find((x) => x.worktree === directory)) return
        setStore("projects", storeKey, [{ worktree: directory, expanded: true }, ...current])
      },
      close(directory: string) {
        const current = store.projects[storeKey] ?? []
        setStore(
          "projects",
          storeKey,
          current.filter((x) => x.worktree !== directory),
        )
      },
      expand(directory: string) {
        const current = store.projects[storeKey] ?? []
        const index = current.findIndex((x) => x.worktree === directory)
        if (index !== -1) setStore("projects", storeKey, index, "expanded", true)
      },
      collapse(directory: string) {
        const current = store.projects[storeKey] ?? []
        const index = current.findIndex((x) => x.worktree === directory)
        if (index !== -1) setStore("projects", storeKey, index, "expanded", false)
      },
      move(directory: string, toIndex: number) {
        const current = store.projects[storeKey] ?? []
        const fromIndex = current.findIndex((x) => x.worktree === directory)
        if (fromIndex === -1 || fromIndex === toIndex) return
        const result = [...current]
        const [item] = result.splice(fromIndex, 1)
        result.splice(toIndex, 0, item)
        setStore("projects", storeKey, result)
      },
      last() {
        return store.lastProject[storeKey]
      },
      touch(directory: string) {
        setStore("lastProject", storeKey, directory)
      },
    },
  }
}

export type ServerCtx = ReturnType<typeof createServerCtx>

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

function projectsKey(key: ServerConnection.Key) {
  if (key === "sidecar") return "local"
  if (isLocalHost(key)) return "local"
  return key
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
