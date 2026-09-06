import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { type HomeProjectSelection, useLayout } from "@/shell/state/layout"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { toggleHomeProjectSelection } from "@/shell/layout/helpers"
import { createEffect, createMemo, startTransition } from "solid-js"
import type { SessionInfo } from "@opencode-ai/client/promise"

export function createHomeController() {
  const layout = useLayout()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const selection = layout.home.selection
  const focusedServer = createMemo<ServerConnection.Any | undefined>(
    () => servers.visible.find((conn) => ServerConnection.key(conn) === selection().server) ?? servers.visible[0],
  )
  const focusedServerCtx = useServerCtx(focusedServer)
  const focusedSync = () => focusedServerCtx()?.sync
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? [])
  const recentlyClosed = createMemo(() => focusedServerCtx()?.projects.recentlyClosed() ?? [])
  const homedir = createMemo(() => focusedSync()?.data.path.home ?? "")
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))
  const newSessionProject = createMemo(
    () =>
      selectedProject() ??
      projects().find((project) => project.worktree === focusedServerCtx()?.projects.last()) ??
      projects()[0],
  )

  createEffect(() => {
    const list = servers.visible
    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list[0]
    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })
  createEffect(() => {
    const ctx = focusedServerCtx()
    const id = selectedProject()?.id
    if (!ctx || !id || ctx.sdk.connection.status() !== "connected") return
    // Selecting a project is the demand for its worktree inventory: the session filter spans its worktrees.
    const root = ctx.sync.data.project.find((project) => project.id === id)?.worktree
    if (root) void ctx.sync.worktrees.load(root)
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  function openProjectSession(conn: ServerConnection.Any, directory: string, session: SessionInfo) {
    const ctx = global.ensureServerCtx(conn)
    void ctx.data.session.message.sync(session.id).catch(() => undefined)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
      ctx.data.session.remember(session)
      ctx.projects.open(directory)
      ctx.projects.touch(directory)
    })
  }

  return {
    selection: {
      value: selection,
      set: setSelection,
      focusServer: (conn: ServerConnection.Any) => setSelection({ server: ServerConnection.key(conn) }),
    },
    server: {
      list: () => servers.visible,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      context: (conn: ServerConnection.Any) => global.ensureServerCtx(conn),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      list: projects,
      recentlyClosed,
      homedir,
      selected: selectedProject,
      newSession: newSessionProject,
      forServer: (conn: ServerConnection.Any) => global.ensureServerCtx(conn).projects.list(),
      select: (conn: ServerConnection.Any, directory: string) => {
        const key = ServerConnection.key(conn)
        if (global.servers.health[key]?.healthy === false) return
        if (
          !global
            .ensureServerCtx(conn)
            .projects.list()
            .some((project) => project.worktree === directory)
        )
          return
        setSelection(toggleHomeProjectSelection(selection(), key, directory))
      },
      add: (conn: ServerConnection.Any, directories: string[]) => {
        const directory = directories[0]
        if (!directory) return
        const ctx = global.ensureServerCtx(conn)
        directories.forEach((item) => {
          if (ctx.projects.list().some((project) => project.worktree === item)) return
          const location = { directory: item }
          void ctx.sdk.api.file
            .list({ path: ".", location })
            .then(async (files) => {
              // TODO: Initialize empty directories when V2 exposes a native Git init API.
              return ctx.sdk.api.project.current({ location })
            })
            .then((project) => ctx.sync.child(item, { bootstrap: false })[1]("project", project.id))
            .catch(() => undefined)
          ctx.projects.open(item)
        })
        ctx.projects.touch(directory)
        setSelection({ server: ServerConnection.key(conn), directory })
      },
      openNewSession: () => {
        const conn = focusedServer()
        const project = newSessionProject()
        if (!conn || !project) return
        openProjectNewSession(conn, project.worktree)
      },
      openProjectNewSession,
      openProjectSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
