import { createMemo } from "solid-js"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { useServerSDK } from "@/runtime/server/client"
import { serverName, ServerConnection, useServers } from "@/runtime/server/registry"
import { useWorkspaceLocation } from "@/workspaces/location"
import { workspaceSelectionDestination } from "@/workspaces/paths"
import { useTabs } from "@/shell/tabs/tabs"
import type { PromptProjectControls } from "./selector"

export function createComposerProjectControls(props: { draftId: string; worktree: () => string }) {
  const servers = useServers()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const projectServer = () => serverSDK.server
  const projectServerCtx = useServerCtx(projectServer)
  const projects = createMemo(() => {
    if (servers.list.length <= 1) return projectServerCtx().projects.list()
    return servers.list.flatMap((connection) => {
      const server = { key: ServerConnection.key(connection), name: serverName(connection) }
      return global
        .ensureServerCtx(connection)
        .projects.list()
        .map((project) => ({ ...project, server }))
    })
  })
  const selectProject = (worktree: string, serverKey?: string) => {
    const connection = serverKey
      ? servers.list.find((connection) => ServerConnection.key(connection) === serverKey)
      : projectServer()
    if (!connection) return

    const target = global.ensureServerCtx(connection)
    target.projects.open(worktree)
    target.projects.touch(worktree)
    tabs.updateDraft(props.draftId, {
      server: ServerConnection.key(connection),
      directory: worktree,
      worktree: workspaceSelectionDestination(props.worktree(), location().directory),
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
        if (directory) selectProject(directory, serverKey)
      },
    })
  }

  return createMemo<PromptProjectControls>(() => ({
    available: projects(),
    directory: location().directory,
    server: servers.list.length > 1 ? ServerConnection.key(projectServer()) : undefined,
    select: selectProject,
    add: addProject,
  }))
}
