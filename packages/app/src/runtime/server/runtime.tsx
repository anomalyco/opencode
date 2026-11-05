import { createSimpleContext } from "@opencode/ui/context"
import {
  Accessor,
  batch,
  createComputed,
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
} from "solid-js"
import { createServerProjects, ServerConnection, useServers } from "./registry"
import {
  createServerControllersState,
  selectServerCtx,
  selectServerSignedOut,
  serverCredentials,
  transitionServerControllers,
  type ServerControllersEvent,
} from "./machine"
import { pathKey } from "@/workspaces/path-key"
import { useServerHealth } from "@/runtime/server/health"
import { selectServerHostname } from "@/runtime/server/health-machine"
import { createServerSdkContext } from "./client"
import { createServerSyncContext } from "./sync"
import { createData, createSessionRetention } from "@opencode/client/solid"
import type { ServerScope } from "@/runtime/server/scope"
import { createPermissionAutoApprover } from "@/session/requests/auto-approve"
import { createSessionMessageHandoffs } from "@/session/handoff"
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
    const models = createGlobalModels()
    const notificationCoordinator = createNotificationCoordinator()
    const owner = getOwner()

    if (!owner) throw new Error("Global provider requires a Solid owner")

    // Every server's controller, created and disposed only by the machine's effects. Readers derive the live
    // controller from this state and never start one themselves.
    const [controllers, setControllers] = createSignal(createServerControllersState<ServerCtx>())

    const dispatch = (event: ServerControllersEvent<ServerCtx>) =>
      batch(() => {
        const result = transitionServerControllers(untrack(controllers), event)
        setControllers(result.state)

        // A replaced controller is disposed before its successor starts, so the old one's cleanup cannot undo what the
        // new one registers under the same server key.
        result.effects.forEach((effect) => {
          if (effect.type === "dispose") return effect.dispose()

          const created = createRoot(
            (dispose) => ({
              ctx: createServerController(
                effect.conn,
                server.scope(effect.key),
                () => server.local(effect.conn),
                server.projects.forServer(effect.key),
                notificationCoordinator,
              ),
              dispose,
            }),
            owner,
          )

          dispatch({ type: "controller.created", key: effect.key, attempt: effect.attempt, ...created })
        })
      })

    const serverHealth = useServerHealth(
      () => server.list,
      (probe) => dispatch({ type: "health.reported", key: probe.key, auth: probe.auth, result: probe.result }),
    )

    // Runs during updates, so listed servers have a controller before anything reads them, including on first render.
    // Reading the credentials here tracks the saved password and a plugin server's endpoint and state.
    createComputed(() => {
      const entries = server.list.map((conn) => ({
        key: ServerConnection.key(conn),
        conn,
        credentials: serverCredentials(conn),
      }))

      untrack(() => dispatch({ type: "servers.synced", entries }))
    })

    onCleanup(() => dispatch({ type: "disposed" }))

    createEffect(() => {
      for (const conn of server.list) {
        const key = ServerConnection.key(conn)
        const hostname = selectServerHostname(serverHealth.status[key])

        if (hostname) server.setHostname(key, hostname)
      }
    })

    return {
      servers: {
        list: () => server.list,
        health: serverHealth.status,
        retry: serverHealth.retry,
      },
      models,
      /** Runs each keyed sound and system notification once across windows; notifications only while none has focus. */
      notifications: notificationCoordinator,
      /** The live controller of a server, or undefined while it is unlisted or rejects our credentials. Reactive. */
      serverCtx(key: ServerConnection.Key) {
        return selectServerCtx(controllers(), key)
      },
      /** The server rejects our credentials and waits for the user to sign in again. Reactive. */
      serverSignedOut(key: ServerConnection.Key) {
        return selectServerSignedOut(controllers(), key)
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
  isLocal: Accessor<boolean>,
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

  // Execution and collected Shell activity can arrive before session metadata. Load missing ancestors so a
  // descendant still keeps its root busy after reconnecting, without reading transcripts.
  createEffect(() => {
    new Set([...data.session.active(), ...data.shell.activeSessions()].map((id) => data.session.root(id))).forEach(
      (id) => {
        if (data.session.get(id)) return
        void data.session.sync(id).catch(() => undefined)
      },
    )
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
  const autoApprove = createPermissionAutoApprover({ sdk, data })
  const notification = createServerNotificationState({ sdk, data, key: connKey, coordinator: notificationCoordinator })
  // Owned by the server, so a first prompt's handoff outlives the draft that sent it.
  const handoff = createSessionMessageHandoffs({ sdk, data })

  // Projects whose repository has no root commit share the `global` ID; their name and icon stay local to the
  // directory because the server cannot tell them apart.
  function withLocalMeta(project: Project): Project {
    if (project.id !== "global") return project

    return { ...project, ...sync.child(project.worktree)[0].projectMeta }
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

  function touch(directory: string) {
    const project = forDirectory(directory)
    if (!project) return
    // A hidden path can have several historical IDs; reopening it restores all of them together.
    projects.use(
      list()
        .filter((item) => pathKey(item.worktree) === pathKey(project.worktree))
        .map((item) => item.id),
    )
    projects.touch(project.id)
  }

  // Resolving a directory registers its project on the server and makes it this client's last used one.
  function add(directory: string) {
    return sdk.api.location
      .get({ location: { directory } })
      .then(async (location) => {
        await sync.project.refresh()
        touch(directory)

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

  return {
    data,
    sdk,
    sync,
    get isLocal() {
      return isLocal()
    },
    projects: {
      list,
      unique,
      // Server history is shared across clients; only an explicit local hide excludes a project.
      visible: createMemo(() => {
        const hidden = new Set(projects.hidden())
        const paths = new Set(list().flatMap((project) => (hidden.has(project.id) ? [pathKey(project.worktree)] : [])))
        return unique().filter((project) => !paths.has(pathKey(project.worktree)))
      }),
      used,
      add,
      forDirectory,
      forSession: (session: Pick<SessionInfo, "projectID" | "location">): Project | undefined =>
        projectForSession(session, list()),
      last: () => list().find((project) => project.id === projects.last()),
      // Marks the project of a directory as used from this client, and as the last one.
      touch,
      // Removes a project from this client's used projects until it is used again; the server keeps it.
      hide(project: Pick<Project, "worktree">) {
        const key = pathKey(project.worktree)
        projects.hide(list().flatMap((item) => (pathKey(item.worktree) === key ? [item.id] : [])))
      },
    },
    notification,
    autoApprove,
    handoff,
  }
}

/** The live controller of a server, or undefined while it is unlisted or rejects our credentials. Reactive. */
export function useServerCtx(server: Accessor<ServerConnection.Any | undefined>) {
  const global = useGlobal()

  return () => {
    const conn = server()

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  }
}

export type ServerCtx = ReturnType<typeof createServerController>
