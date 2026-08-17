import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { type Accessor, createMemo } from "solid-js"
import type { PromptInputControls } from "@/components/prompt-input/contracts"
import type { PromptProjectControls } from "@/components/prompt-project-selector"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal, useServerCtx } from "@/context/global"
import { useLayout } from "@/context/layout"
import { useLocal, type ModelSelection } from "@/context/local"
import { useServerSDK } from "@/context/server-sdk"
import { serverName, ServerConnection, useServers } from "@/context/servers"
import { useWorkspaceLocation } from "@/context/location"
import { useTabs } from "@/context/tabs"
import { useProviders } from "@/hooks/use-providers"
import { useData } from "@/context/server"
import { normalizeAgentList } from "@/context/global-sync/utils"

export function createPromptInputController(input: {
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
  model?: ModelSelection
}) {
  const layout = useLayout()
  const local = useLocal()
  const sdk = useWorkspaceLocation()
  const data = useData()
  const providers = useProviders(() => sdk().directory)
  const view = layout.view(input.sessionKey)

  return createMemo<PromptInputControls>(() => {
    return {
      agents: {
        available: normalizeAgentList(data.location.agent.list({ directory: sdk().directory }) ?? []),
        options: local.agent.list().map((agent) => agent.name),
        current: local.agent.current()?.name ?? "",
        loading: data.location.agent.list({ directory: sdk().directory }) === undefined,
        visible: local.agent.visible(),
        select: local.agent.set,
      },
      model: {
        selection: input.model ?? local.model,
        paid: providers.paid().length > 0,
        loading: (local.agent.visible() && data.location.agent.list({ directory: sdk().directory }) === undefined) || !providers.ready(),
      },
      session: {
        id: input.sessionID(),
        tabs: layout.tabs(input.sessionKey),
        reviewPanel: view.reviewPanel,
      },
    }
  })
}

export function createPromptProjectControls(props: { draftId: string }) {
  const server = useServers()
  const serverSDK = useServerSDK()
  const sdk = useWorkspaceLocation()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const projectServer = () => serverSDK.server
  const projectServerCtx = useServerCtx(projectServer)
  const projects = createMemo(() => {
    if (server.list.length <= 1) {
      return projectServerCtx().projects.list()
    }
    return server.list.flatMap((conn) => {
      const item = { key: ServerConnection.key(conn), name: serverName(conn) }
      return global
        .ensureServerCtx(conn)
        .projects.list()
        .map((project) => ({ ...project, server: item }))
    })
  })
  const selectProject = (worktree: string, serverKey?: string) => {
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (!conn) return

    const target = global.ensureServerCtx(conn)
    target.projects.open(worktree)
    target.projects.touch(worktree)
    tabs.updateDraft(props.draftId, { server: ServerConnection.key(conn), directory: worktree, worktree: undefined })
  }

  const addProject = (title: string, serverKey?: string) => {
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (!conn) return
    pickDirectory({
      server: conn,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result
        if (directory) selectProject(directory, serverKey)
      },
    })
  }

  return createMemo<PromptProjectControls>(() => ({
    available: projects(),
    directory: sdk().directory,
    server: server.list.length > 1 ? ServerConnection.key(projectServer()) : undefined,
    select: selectProject,
    add: addProject,
  }))
}
