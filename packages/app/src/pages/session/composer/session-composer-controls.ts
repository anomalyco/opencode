import { base64Encode } from "@opencode-ai/core/util/encode"
import { createQuery } from "@tanstack/solid-query"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { type Accessor, createMemo } from "solid-js"
import type { PromptInputControls } from "@/components/prompt-input"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import type { QueryOptionsApi } from "@/context/server-sync"
import { ServerConnection, useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { type DraftTab, useTabs } from "@/context/tabs"
import { useProviders } from "@/hooks/use-providers"
import { pathKey } from "@/utils/path-key"

export function createSessionComposerControls(input: {
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
  queryOptions: Pick<QueryOptionsApi, "agents" | "providers">
}) {
  const navigate = useNavigate()
  const layout = useLayout()
  const local = useLocal()
  const providers = useProviders()
  const settings = useSettings()
  const server = useServer()
  const sync = useSync()
  const sdk = useSDK()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const [search] = useSearchParams<{ draftId?: string }>()
  const view = layout.view(input.sessionKey)

  const draft = createMemo(() => {
    if (!search.draftId) return
    return tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
  })
  const projectServer = createMemo(() => {
    if (!search.draftId) return server.current
    const target = draft()?.server
    if (!target) return
    return server.list.find((conn) => ServerConnection.key(conn) === target)
  })
  const projectServerCtx = createMemo(() => {
    const conn = projectServer()
    if (conn) return global.ensureServerCtx(conn)
  })
  const projects = createMemo(() =>
    search.draftId ? (projectServerCtx()?.projects.list() ?? []) : layout.projects.list(),
  )
  const agentsQuery = createQuery(() => input.queryOptions.agents(pathKey(sdk().directory)))
  const globalProvidersQuery = createQuery(() => input.queryOptions.providers(null))
  const providersQuery = createQuery(() => input.queryOptions.providers(pathKey(sdk().directory)))

  const selectProject = (worktree: string) => {
    const conn = projectServer()
    const target = projectServerCtx()
    if (search.draftId) {
      if (!conn || !target) return
      target.projects.open(worktree)
      target.projects.touch(worktree)
      tabs.updateDraft(search.draftId, { server: ServerConnection.key(conn), directory: worktree })
      return
    }

    layout.projects.open(worktree)
    server.projects.touch(worktree)
    navigate(`/${base64Encode(worktree)}/session`)
  }

  const addProject = (title: string) => {
    const conn = projectServer()
    if (!conn) return
    pickDirectory({
      server: conn,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result
        if (directory) selectProject(directory)
      },
    })
  }

  return createMemo<PromptInputControls>(() => ({
    agents: {
      available: sync().data.agent,
      options: local.agent.list().map((agent) => agent.name),
      current: local.agent.current()?.name ?? "",
      loading: agentsQuery.isLoading,
      visible: settings.visibility.customAgents(),
      select: local.agent.set,
    },
    model: {
      selection: local.model,
      paid: providers.paid().length > 0,
      loading: agentsQuery.isLoading || providersQuery.isLoading || globalProvidersQuery.isLoading,
    },
    projects: {
      available: projects(),
      directory: sdk().directory,
      select: selectProject,
      add: addProject,
    },
    session: {
      id: input.sessionID(),
      tabs: layout.tabs(input.sessionKey),
      reviewPanel: view.reviewPanel,
    },
    newLayoutDesigns: settings.general.newLayoutDesigns(),
  }))
}
