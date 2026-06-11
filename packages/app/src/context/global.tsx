import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createServerProjects, ServerConnection, useServer } from "./server"
import { useServerHealth } from "@/utils/server-health"
import { createServerSdkContext } from "./server-sdk"
import { createServerSyncContext } from "./server-sync"
import { getOwner } from "solid-js/web"
import { QueryClient } from "@tanstack/solid-query"
import type { ServerScope } from "@/utils/server-scope"

export const { use: useGlobal, provider: GlobalProvider } = createSimpleContext({
  name: "Global",
  init: () => {
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

    const ensureServerCtx = (conn: ServerConnection.Any) => {
      const key = ServerConnection.key(conn)
      const existing = serverCtxs.get(key)
      if (existing) return existing.serverCtx
      const root = createRoot((dispose) => {
        const serverCtx = createServerCtx(conn, server.scope(key), server.projects.forServer(key))
        return { dispose, serverCtx }
      }, owner as any)
      serverCtxs.set(key, root)
      return root.serverCtx
    }

    createMemo(() => {
      for (const conn of server.list) {
        ensureServerCtx(conn)
      }
    })

    createEffect(() => {
      for (const [key] of serverCtxs) {
        if (!server.list.find((conn) => ServerConnection.key(conn) === key)) {
          const { dispose } = serverCtxs.get(key)!
          dispose()
          serverCtxs.delete(key)
        }
      }
    })

    return {
      servers: {
        list: () => server.list,
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
        return ensureServerCtx(conn)
      },
    }
  },
})

function createServerCtx(
  conn: ServerConnection.Any,
  scope: ServerScope,
  projects: ReturnType<typeof createServerProjects>,
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
  const sdk = createServerSdkContext(conn, scope)
  const sync = createServerSyncContext(sdk)

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

  const projectsList = createMemo(() => projects.list().map(enrich))

  const isLocal =
    (conn?.type === "sidecar" && conn.variant === "base") || (conn?.type === "http" && isLocalHost(conn.http.url))

  return {
    queryClient,
    sdk,
    sync,
    isLocal,
    projects: {
      ...projects,
      list: projectsList,
    },
  }
}

export type ServerCtx = ReturnType<typeof createServerCtx>

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}
