import { createSimpleContext } from "@opencode/ui/context"
import { Accessor, batch, createEffect, createMemo, createResource, createRoot, getOwner, untrack } from "solid-js"
import { createServerProjects, ServerConnection, useServers } from "./registry"
import { pathKey } from "@/workspaces/path-key"
import { useServerHealth } from "@/runtime/server/health"
import { createServerSdkContext } from "./client"
import { createServerSyncContext } from "./sync"
import { createData, createSessionRetention } from "@opencode/client/solid"
import type { ServerScope } from "@/runtime/server/scope"
import { createPermissionAutoApprover } from "@/session/requests/auto-approve"
import { createServerNotificationState } from "@/shell/notifications/notification"
import { createNotificationCoordinator } from "@/shell/notifications/coordinator"
import { useCurrentRoute } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { createDesktopData } from "./data"
import { ModelState } from "./persistence"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { formatServerError } from "./errors"
import { useSettings } from "@/settings/model"
import { timelinePreset } from "@opencode/session-ui/timeline/detail"
import type { SessionInfo } from "@opencode/client/promise"
import { projectForSession } from "@/shell/layout/helpers"
import { isProjectDirectory } from "@/workspaces/paths"
import type { Project } from "@/runtime/server/types"

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
    // The credentials each controller started with, as plain values: the listed connection is a store proxy that
    // already reads the new password once the user saves it.
    const serverCtxCredentials = new Map<ServerConnection.Key, string>()

    const owner = getOwner()

    if (!owner) throw new Error("Global provider requires a Solid owner")

    const disposeServerCtx = (key: ServerConnection.Key) => {
      serverCtxDisposers.get(key)?.()
      serverCtxDisposers.delete(key)
      serverCtxCredentials.delete(key)
      serverCtxs.delete(key)
    }

    const ensureServerCtx = (input: ServerConnection.Any) => {
      const key = ServerConnection.key(input)
      // Callers can hold an older copy of the connection; the listed one has the credentials the user saved last.
      const conn = untrack(() => server.list.find((item) => ServerConnection.key(item) === key)) ?? input
      const existing = serverCtxs.get(key)

      if (existing && serverCtxCredentials.get(key) === credentials(conn)) return existing

      // A controller keeps the credentials it started with, so a server signed in again under the same address needs
      // a new one.
      if (existing) disposeServerCtx(key)

      const serverCtx = createRoot((dispose) => {
        serverCtxDisposers.set(key, dispose)

        return createServerController(conn, server.scope(key), server.projects.forServer(key), notificationCoordinator)
      }, owner)

      serverCtxs.set(key, serverCtx)
      serverCtxCredentials.set(key, credentials(conn))

      return serverCtx
    }

    // A server that rejects our credentials would retry its event stream every second with the same
    // credentials, so its controller waits until health recovers and then starts with the current ones.
    createMemo(() => {
      for (const conn of server.list) {
        if (serverHealth.status[ServerConnection.key(conn)]?.unauthorized) continue
        ensureServerCtx(conn)
      }
    })

    createEffect(() => {
      for (const conn of server.list) {
        const key = ServerConnection.key(conn)
        const hostname = serverHealth.status[key]?.hostname

        if (hostname) server.setHostname(key, hostname)
      }
    })

    createEffect(() => {
      for (const [key] of serverCtxs) {
        if (serverHealth.status[key]?.unauthorized || !server.list.find((conn) => ServerConnection.key(conn) === key))
          disposeServerCtx(key)
      }
    })

    return {
      servers: {
        list: () => server.list,
        health: serverHealth.status,
        retry: serverHealth.retry,
      },
      models,
      ensureServerCtx(conn: ServerConnection.Any) {
        return ensureServerCtx(conn)
      },
      /** The live controller of a server, or undefined while it is unlisted or rejects our credentials. Reactive. */
      serverCtx(key: ServerConnection.Key) {
        const conn = server.list.find((item) => ServerConnection.key(item) === key)

        if (!conn || serverHealth.status[key]?.unauthorized) return

        return ensureServerCtx(conn)
      },
    }
  },
})

function createGlobalModels() {
  const [store, setStore, _, ready] = persisted(Persist.global("model"), ModelState, {
    user: [],
    recent: [],
    favorite: [],
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
    favorite: () => {
      loaded()

      return store.favorite
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
  const tabs = useTabs()
  const currentRoute = useCurrentRoute()
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
    // The timeline shows tool output as text only, so screenshots in tool results never need their bytes here.
    omitToolFileData: true,
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

  // Transcripts otherwise stay loaded for every session this window ever opened. Open tabs and the three most
  // recently viewed sessions keep theirs; any other session reloads its transcript when it is opened again.
  createSessionRetention({
    session: data.session,
    current: () => {
      const route = currentRoute()

      return route.type === "session" && route.server === connKey ? route.sessionId : undefined
    },
    // Until the stored tabs load, keep every transcript so startup never evicts a tab's session.
    keep: () =>
      tabs.ready()
        ? tabs.store.flatMap((tab) =>
            tab.type === "session" && tab.server === connKey
              ? [tab.sessionId, ...(tab.routeSessionId ? [tab.routeSessionId] : [])]
              : [],
          )
        : data.session.list().map((session) => session.id),
    limit: 3,
  })

  const sync = createServerSyncContext(sdk, data)
  createPermissionAutoApprover({ sdk, data })
  const notification = createServerNotificationState({ sdk, data, key: connKey, coordinator: notificationCoordinator })

  // Projects whose repository has no root commit share the `global` ID; their name and icon stay local to the
  // directory because the server cannot tell them apart.
  function withLocalMeta(project: Project): Project {
    if (project.id !== "global") return project

    return { ...project, ...sync.child(project.worktree, { bootstrap: false })[0].projectMeta }
  }

  const list = createMemo(() => sync.data.project.map(withLocalMeta))

  // One directory can belong to several project IDs, for example a folder resolved before `.git` existed and again
  // after a remote was added. The list is most recent first, so the first project per path is the current one.
  const unique = createMemo(() => {
    const seen = new Set<string>()

    return list().filter((project) => {
      const key = pathKey(project.worktree)

      if (seen.has(key)) return false
      seen.add(key)

      return true
    })
  })

  // The projects this client has used, in server order. Using any ID of a path shows that path's current project.
  const used = createMemo(() => {
    const ids = new Set(projects.used())
    const paths = new Set(list().flatMap((project) => (ids.has(project.id) ? [pathKey(project.worktree)] : [])))

    return unique().filter((project) => paths.has(pathKey(project.worktree)))
  })

  const forDirectory = (directory: string): Project | undefined => {
    const key = pathKey(directory)

    return (
      list().find(
        (project) => pathKey(project.worktree) === key || project.sandboxes.some((sandbox) => pathKey(sandbox) === key),
      ) ??
      list()
        .filter((project) => isProjectDirectory(project, directory))
        .toSorted((a, b) => b.worktree.length - a.worktree.length)[0]
    )
  }

  // Older builds kept opened directories locally; once the server's list loads they become used project IDs.
  createEffect(() => {
    const legacy = projects.legacy()

    if (!legacy || !sync.project.ready()) return
    untrack(() => projects.migrate(legacy.flatMap((directory) => forDirectory(directory)?.id ?? [])))
  })

  // Resolving a directory registers its project on the server; the list then reloads to include it, and the
  // project becomes this client's last used one.
  function add(directory: string) {
    return sdk.api.location
      .get({ location: { directory } })
      .then(async (location) => {
        await sync.project.refresh()
        projects.touch(location.project.id)

        return list().find((project) => project.id === location.project.id)
      })
      .catch((error) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: formatServerError(error, language.t),
        })

        return undefined
      })
  }

  const isLocal =
    (conn?.type === "sidecar" && conn.variant === "base") || (conn?.type === "http" && isLocalHost(conn.http.url))

  return {
    data,
    sdk,
    sync,
    isLocal,
    projects: {
      list,
      unique,
      used,
      add,
      forDirectory,
      forSession: (session: SessionInfo): Project | undefined => projectForSession(session, list()),
      last: () => list().find((project) => project.id === projects.last()),
      // Marks the project of a directory as used from this client, and as the last one.
      touch(directory: string) {
        const id = forDirectory(directory)?.id

        if (id) projects.touch(id)
      },
      // Removes a project from this client's used projects until it is used again; the server keeps it.
      hide(project: Pick<Project, "worktree">) {
        const key = pathKey(project.worktree)
        projects.hide(list().flatMap((item) => (pathKey(item.worktree) === key ? [item.id] : [])))
      },
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

/** What an HTTP server's controller authenticates with; other servers keep one controller per id. */
function credentials(conn: ServerConnection.Any) {
  return conn.type === "http" ? `${conn.http.url}\n${conn.http.password ?? ""}` : ""
}
