import { createMemo } from "solid-js"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { type ServerCtx, useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useWorkspaceLocation } from "@/workspaces/location"
import { workspaceSelectionDestination } from "@/workspaces/paths"
import { useTabs } from "@/shell/tabs/tabs"
import type { PromptProjectControls, PromptServer } from "./selector"

export function createComposerProjectControls(props: { draftId: string; worktree: () => string }) {
  const servers = useServers()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const projectServer = () => serverSDK.server
  const projectServerCtx = useServerCtx(projectServer)

  // Every server project, one per directory, marked as used by this client or not; the selector orders them.
  const listed = (ctx: ServerCtx, server?: PromptServer) => {
    const used = ctx.projects.used()
    const ids = new Set(used.map((project) => project.id))

    return [
      ...used.map((project) => ({ ...project, used: true, server })),
      ...ctx.projects
        .unique()
        .filter((project) => !ids.has(project.id))
        .map((project) => ({ ...project, used: false, server })),
    ]
  }

  function promptServer(connection: ServerConnection.Any): PromptServer {
    return {
      key: ServerConnection.key(connection),
      name: servers.label(connection),
      hint: servers.hint(connection),
      kind: servers.current(connection) ? "current" : connection.type === "plugin" ? "plugin" : "remote",
      label: connection.label,
    }
  }

  // Servers that are down or still connecting contribute nothing.
  const ready = createMemo(() =>
    servers.list.filter((connection) => {
      if (connection.type === "plugin" && connection.state !== "ready") return false

      return global.servers.health[ServerConnection.key(connection)]?.healthy !== false
    }),
  )

  const projects = createMemo(() => {
    if (servers.list.length <= 1) return listed(projectServerCtx())

    return ready().flatMap((connection) => listed(global.ensureServerCtx(connection), promptServer(connection)))
  })

  const selectProject = (directory: string, serverKey?: string, workspace?: string) => {
    const connection = serverKey
      ? servers.list.find((connection) => ServerConnection.key(connection) === serverKey)
      : projectServer()

    if (!connection) return

    global.ensureServerCtx(connection).projects.touch(directory)
    tabs.updateDraft(props.draftId, {
      server: ServerConnection.key(connection),
      directory,
      worktree: workspace ?? workspaceSelectionDestination(props.worktree(), location().directory),
      branch: undefined,
    })
  }

  const addProject = (title: string, serverKey?: string) => {
    const connection = serverKey
      ? servers.list.find((connection) => ServerConnection.key(connection) === serverKey)
      : projectServer()

    if (!connection) return
    pickDirectory({
      server: connection,
      location: ServerConnection.key(connection) === ServerConnection.key(projectServer()) ? location().ref : undefined,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result

        if (!directory) return
        void global.ensureServerCtx(connection).projects.add(directory)
        selectProject(directory, serverKey)
      },
    })
  }

  return createMemo<PromptProjectControls>(() => ({
    available: projects(),
    servers: servers.list.length > 1 ? ready().map(promptServer) : undefined,
    directory: location().directory,
    projectID: location().current?.project.id,
    server: servers.list.length > 1 ? ServerConnection.key(projectServer()) : undefined,
    select: selectProject,
    add: addProject,
  }))
}
