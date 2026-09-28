import { createSimpleContext } from "@opencode/ui/context"
import { Accessor, batch, createEffect, createMemo, createResource, createRoot, getOwner } from "solid-js"
import { createServerProjects, RECENTLY_CLOSED_DISPLAY_LIMIT, ServerConnection, useServers } from "./registry"
import { pathKey } from "@/workspaces/path-key"
import { useServerHealth } from "@/runtime/server/health"
import { createServerSdkContext } from "./client"
import { createServerSyncContext } from "./sync"
import { createData } from "@opencode/client/solid"
import type { ServerScope } from "@/runtime/server/scope"
import { createPermissionAutoApprover } from "@/session/requests/auto-approve"
import { createServerNotificationState } from "@/shell/notifications/notification"
import { createNotificationCoordinator } from "@/shell/notifications/coordinator"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { createDesktopData } from "./data"
import { ModelState } from "./persistence"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { formatServerError } from "./errors"
import { useSettings } from "@/settings/model"
import { timelinePreset } from "@opencode/session-ui/timeline/detail"
import type { SessionInfo } from "@opencode/client/promise"
import { resolveProjectForSession, resolveSessionDetailsProject } from "@/shell/layout/helpers"

export const { use: useGlobal, provider: GlobalProvider } = createSimpleContext({
  name: "Global",
  init: () => {
    const server = useServers()
    const serverHealth = useServerHealth(
      () => server.list,
      () => true,
    )
    const models = createGlobalModels()
    const notificationCoordinator = createNotificationCoordinator()

    const serverCtxs = new Map<ServerConnection.Key, ReturnType<typeof createServerController>>()
    const serverCtxDisposers = new Map<ServerConnection.Key, () => void>()

    const owner = getOwner()
    if (!owner) throw new Error("Global provider requires a Solid owner")

    const ensureServerCtx = (conn: ServerConnection.Any) => {
      const key = ServerConnection.key(conn)
      const existing = serverCtxs.get(key)
      if (existing) return existing
      const serverCtx = createRoot((dispose) => {
        serverCtxDisposers.set(key, dispose)
        return createServerController(conn, server.scope(key), server.projects.forServer(key), notificationCoordinator)
      }, owner)
      serverCtxs.set(key, serverCtx)
      return serverCtx
    }

    // A server that rejects our credentials would retry its event stream every second with the same
    // credentials, so its controller waits until health recovers and then starts with the current ones.
    createMemo(() => {
      for (const conn of server.list) {
        if (serverHealth[ServerConnection.key(conn)]?.unauthorized) continue
        ensureServerCtx(conn)
      }
    })

    createEffect(() => {
      for (const [key] of serverCtxs) {
        if (serverHealth[key]?.unauthorized || !server.list.find((conn) => ServerConnection.key(conn) === key)) {
          serverCtxDisposers.get(key)?.()
          serverCtxDisposers.delete(key)
          serverCtxs.delete(key)
        }
      }
    })

    return {
      servers: {
        list: () => server.list,
        health: serverHealth,
      },
      models,
      ensureServerCtx(conn: ServerConnection.Any) {
        return ensureServerCtx(conn)
      },
    }
  },
})

function createGlobalModels() {
  const [store, setStore, _, ready] = persisted(Persist.global("model"), ModelState, {
    user: [],
    recent: [],
    variant: {},
  })
  // Suspend readers only until persisted state loads. Refetching on every change would put the
  // session route into its Suspense fallback, detaching the screen and resetting the timeline scroll.
  const [loaded] = createResource(async () => {
    await ready.promise
    return true
  })

  return {
    store,
    set: setStore,
    ready,
    recent: () => {
      loaded()
      return store.recent
    },
    // Marks models visible in the picker regardless of the "latest per family" default.
    show(models: ReadonlyArray<{ providerID: string; modelID: string }>) {
      const seen = new Map(store.user.map((item, index) => [`${item.providerID}:${item.modelID}`, index]))
      batch(() => {
        for (const model of models) {
          const index = seen.get(`${model.providerID}:${model.modelID}`)
          if (index !== undefined) {
            setStore("user", index, "visibility", "show")
            continue
          }
          seen.set(`${model.providerID}:${model.modelID}`, store.user.length)
          setStore("user", store.user.length, {
            providerID: model.providerID,
            modelID: model.modelID,
            visibility: "show",
          })
        }
      })
    },
  }
}

function createServerController(
  conn: ServerConnection.Any,
  scope: ServerScope,
  projects: ReturnType<typeof createServerProjects>,
  notificationCoordinator: ReturnType<typeof createNotificationCoordinator>,
) {
  const language = useLanguage()
  const settings = useSettings()
  const connKey = ServerConnection.key(conn)
  const sdk = createServerSdkContext(conn, scope)
  const source = createData({
    api: () => sdk.api,
    initialMessageLimit: () => (timelinePreset(settings.general.timelineDetail())?.id === "compact" ? 40 : 20),
    event: {
      on: sdk.event.on,
      listen: (handler) => sdk.event.listen((event) => handler({ name: event.type, details: event })),
    },
    connection: sdk.connection,
    directory: "",
    onError(error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t),
      })
    },
  })
  const data = createDesktopData({
    data: source,
    remove: (sessionID) => sdk.api.session.remove({ sessionID }),
  })
  const sync = createServerSyncContext(sdk, data)
  createPermissionAutoApprover({ sdk, data })
  const notification = createServerNotificationState({ sdk, data, key: connKey, coordinator: notificationCoordinator })

  function enrich(project: { worktree: string; expanded: boolean }) {
    const [childStore] = sync.child(project.worktree, { bootstrap: false })
    const projectID = childStore.project
    const metadata = projectID
      ? sync.data.project.find((x) => x.id === projectID)
      : sync.data.project.find((x) => x.worktree === project.worktree)

    // Preserve local icon override from per-workspace localStorage cache (childStore.icon).
    // Without this, different subdirectories of the same git repo would share the same
    // icon from the database instead of using their individual overrides.
    const base = {
      ...metadata,
      ...(!metadata || metadata.id === "global" ? childStore.projectMeta : undefined),
      ...project,
    }
    if (childStore.icon) {
      return { ...base, icon: { ...base.icon, override: childStore.icon } }
    }
    return base
  }

  const projectsList = createMemo(() => projects.list().map(enrich))
  const forSession = (session: SessionInfo) => {
    const project = resolveProjectForSession(session, projectsList(), sync.data.project)
    if (!project) return
    return "expanded" in project ? project : { ...project, expanded: false }
  }
  const detailsForSession = (session: SessionInfo) =>
    resolveSessionDetailsProject(session, projectsList(), sync.data.project)
  const recentlyClosedList = createMemo(() => {
    const known = new Set(sync.data.project.map((project) => pathKey(project.worktree)))
    return projects
      .recentlyClosed()
      .filter((worktree) => known.has(pathKey(worktree)))
      .slice(0, RECENTLY_CLOSED_DISPLAY_LIMIT)
      .map((worktree) => enrich({ worktree, expanded: false }))
  })

  const isLocal =
    (conn?.type === "sidecar" && conn.variant === "base") || (conn?.type === "http" && isLocalHost(conn.http.url))

  return {
    data,
    sdk,
    sync,
    isLocal,
    projects: {
      ...projects,
      list: projectsList,
      forSession,
      detailsForSession,
      resolve: enrich,
      recentlyClosed: recentlyClosedList,
    },
    notification,
  }
}

export function useServerCtx(server: Accessor<ServerConnection.Any>): Accessor<ServerCtx>
export function useServerCtx(server: Accessor<ServerConnection.Any | undefined>): Accessor<ServerCtx | undefined>
export function useServerCtx(server: Accessor<ServerConnection.Any | undefined>) {
  const global = useGlobal()
  return () => {
    const s = server()
    if (s) return global.ensureServerCtx(s)
  }
}

export type ServerCtx = ReturnType<typeof createServerController>

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}
