import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { useLayout } from "@/shell/state/layout"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { isServerFailed } from "@/runtime/server/health-machine"
import { usePluginServers } from "@/runtime/plugin/servers"
import { createProjectSessionActions } from "@/shell/tabs/project-sessions"
import { batch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { pathKey } from "@/workspaces/path-key"
import { addProjects } from "./projects/add"
import {
  INITIAL_HOME_SELECTION_STATE,
  sameHomeSelection,
  selectHomeSelection,
  transitionHomeSelection,
  type HomeEnvSnapshot,
  type HomeSelectionEffect,
  type HomeSelectionEvent,
} from "./machine"

export function createHomeController() {
  const layout = useLayout()
  const global = useGlobal()
  const servers = useServers()
  const pluginServers = usePluginServers()
  const sessions = createProjectSessionActions()

  const env = createMemo(
    (): HomeEnvSnapshot => ({
      hydrated: layout.ready() && servers.hydrated() && pluginServers.ready(),
      stored: { server: layout.home.selection().server, directory: layout.home.selection().directory },
      servers: servers.visible.map((conn) => {
        const key = ServerConnection.key(conn)
        const ctx = global.serverCtx(key)

        return {
          key,
          failed: isServerFailed(global.servers.health[key]),
          connected: ctx?.sdk.connection.status() === "connected",
          projectsReady: !!ctx?.sync.project.ready() && servers.projects.forServer(key).legacy() === undefined,
          usedProjects: (ctx?.projects.used() ?? []).map((project) => ({ id: project.id, worktree: project.worktree })),
        }
      }),
    }),
  )

  // Seeded synchronously, so the first render already shows a listed server.
  const initial = transitionHomeSelection(INITIAL_HOME_SELECTION_STATE, { type: "env.synced", env: untrack(env) })
  const [machine, setMachine] = createSignal(initial.state)

  const dispatch = (event: HomeSelectionEvent) => {
    const result = transitionHomeSelection(untrack(machine), event)

    if (result.state !== untrack(machine)) setMachine(result.state)
    result.effects.forEach(run)
  }

  // A user action can follow a server change in the same update, before the effect below reports it.
  const send = (event: HomeSelectionEvent) =>
    untrack(() =>
      batch(() => {
        dispatch({ type: "env.synced", env: env() })
        dispatch(event)
      }),
    )

  function run(effect: HomeSelectionEffect) {
    if (effect.type === "selection.persist") return layout.home.setSelection(effect.selection)

    if (effect.type === "worktrees.refresh")
      return void global.serverCtx(effect.server)?.sync.worktrees.refresh(effect.projectID)

    const ctx = global.serverCtx(effect.server)

    if (effect.type === "worktrees.list") {
      // The inventory read never rejects; a failed read still asks the server to discover worktrees.
      if (!ctx) return dispatch({ type: "worktrees.listed", attempt: effect.attempt })

      return void ctx.sync.worktrees
        .list(effect.projectID)
        .then(() => dispatch({ type: "worktrees.listed", attempt: effect.attempt }))
    }

    if (!ctx) return dispatch({ type: "project.added", attempt: effect.attempt, project: undefined })

    void addProjects(ctx, [...effect.directories]).then(
      (project) =>
        send({
          type: "project.added",
          attempt: effect.attempt,
          project: project && { id: project.id, worktree: project.worktree },
        }),
      () => dispatch({ type: "project.added", attempt: effect.attempt, project: undefined }),
    )
  }

  initial.effects.forEach(run)

  createEffect(() => {
    const current = env()
    untrack(() => dispatch({ type: "env.synced", env: current }))
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  const selection = createMemo(() => selectHomeSelection(machine()), undefined, { equals: sameHomeSelection })

  const focusedServer = createMemo(() => {
    const key = selection().server

    return key ? servers.visible.find((conn) => ServerConnection.key(conn) === key) : undefined
  })

  const focusedServerCtx = useServerCtx(focusedServer)
  const focusedSync = () => focusedServerCtx()?.sync
  // Home lists the server's projects this client has used.
  const projects = createMemo(() => focusedServerCtx()?.projects.used() ?? [])

  const selectedProject = createMemo(() => {
    const directory = selection().directory

    return directory ? projects().find((project) => pathKey(project.worktree) === pathKey(directory)) : undefined
  })

  const newSessionProject = createMemo(() => selectedProject() ?? focusedServerCtx()?.projects.last() ?? projects()[0])

  return {
    selection: {
      value: selection,
      focusServer: (conn: ServerConnection.Any) => send({ type: "server.focused", server: ServerConnection.key(conn) }),
    },
    server: {
      list: () => servers.visible,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      label: servers.label,
      context: (conn: ServerConnection.Any) => global.serverCtx(ServerConnection.key(conn)),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      list: projects,
      selected: selectedProject,
      newSession: newSessionProject,
      forServer: (conn: ServerConnection.Any) => global.serverCtx(ServerConnection.key(conn))?.projects.used() ?? [],
      select: (conn: ServerConnection.Any, directory: string) =>
        send({ type: "project.toggled", server: ServerConnection.key(conn), directory }),
      add: (conn: ServerConnection.Any, directories: string[]) =>
        send({ type: "project.add", server: ServerConnection.key(conn), directories }),
      openNewSession: () => {
        const conn = focusedServer()
        const project = newSessionProject()

        if (!conn || !project) return
        sessions.openProjectNewSession(conn, project.worktree)
      },
      openProjectNewSession: sessions.openProjectNewSession,
      openProjectSession: sessions.openProjectSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
