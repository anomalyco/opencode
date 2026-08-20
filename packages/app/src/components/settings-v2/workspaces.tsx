import type { Component } from "solid-js"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Menu } from "@opencode-ai/ui/menu"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useData } from "@/context/server"
import { showToast } from "@/utils/toast"
import { getRelativeTime } from "@/utils/time"
import { sessionLabel } from "@/utils/session-title"
import { pathKey } from "@/utils/path-key"
import { SettingsListV2 } from "./parts/list"
import { InlineServerSelect } from "./parts/server-select"
import { useTabs } from "@/context/tabs"
import { usePlatform } from "@/context/platform"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { ServerConnection } from "@/context/servers"
import type { Project } from "@/types"
import {
  containsDirectory,
  filterWorkspaceInventory,
  inspectWorkspaceDeletion,
  managedWorkspaceDirectories,
  mergeWorkspaceSessionInventory,
  removeWorkspacesSequentially,
  sessionsForWorkspace,
  type WorkspaceDeleteInspection,
  workspaceInventory,
} from "@/utils/workspace"
import { listAllSessions } from "@/utils/session"
import type { ServerScope } from "@/utils/server-scope"
import { normalizeProjectInfo } from "@/context/global-sync/utils"
import "./settings-v2.css"

type Workspace = {
  directory: string
  project: Project
}

export const SettingsWorkspacesV2: Component<{ activeDirectory?: string }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const data = useData()
  const tabs = useTabs()
  const platform = usePlatform()
  const [store, setStore] = createStore({
    project: "all",
    transaction: undefined as "confirm" | "running" | undefined,
  })

  const projectQuery = useQuery(() => ({
    queryKey: [serverSDK.scope, "settings-workspace-projects"] as const,
    queryFn: async () =>
      Promise.all(
        (await serverSDK.api.project.list()).map(async (project) => {
          const worktrees = await serverSDK.api.worktree
            .list({ projectID: project.id })
            .catch(() => [{ directory: project.canonical }, ...project.sandboxes.map((directory) => ({ directory }))])
          return normalizeProjectInfo({ ...project, worktrees })
        }),
      ),
    refetchOnMount: "always",
  }))
  const workspaces = createMemo(() => workspaceInventory(projectQuery.data ?? []))
  const projects = createMemo(() =>
    (projectQuery.data ?? []).filter((project) => managedWorkspaceDirectories(project).length > 0),
  )
  const projectName = (project: Project) => project.name || getFilename(project.worktree)
  const projectOptions = createMemo(() => [
    { id: "all", label: language.t("settings.workspaces.filter.all") },
    ...projects().map((project) => ({ id: project.id, label: projectName(project) })),
  ])
  const selectedProject = createMemo(() =>
    store.project === "all" || projects().some((project) => project.id === store.project) ? store.project : "all",
  )
  const filtered = createMemo(() => filterWorkspaceInventory(workspaces(), selectedProject()))
  const captureDeleteContext = () => {
    const sdk = serverSDK
    return {
      sdk,
      data,
      server: ServerConnection.key(sdk.server),
      activeDirectory: props.activeDirectory,
    }
  }
  const loadSessions = async (context = captureDeleteContext()) => {
    const fetched = await listAllSessions(context.sdk.api.session, { order: "desc" })
    fetched.forEach(context.data.session.remember)
    return mergeWorkspaceSessionInventory(fetched, context.data.session.list())
  }
  const sessionQuery = useQuery(() => ({
    queryKey: [serverSDK.scope, null, "settings-workspace-sessions"] as const,
    queryFn: () => loadSessions().then(() => Date.now()),
    refetchOnMount: "always",
  }))
  const sessionsByWorkspace = createMemo(
    () =>
      new Map(
        workspaces().map((workspace) => [
          pathKey(workspace.directory),
          sessionQuery.isSuccess ? sessionsForWorkspace(data.session.list(), workspace.directory) : [],
        ]),
      ),
  )
  const workspaceSessions = (workspace: Workspace) => sessionsByWorkspace().get(pathKey(workspace.directory)) ?? []
  const sessionCount = (workspace: Workspace) => {
    if (sessionQuery.isPending) return language.t("session.messages.loading")
    if (sessionQuery.isError) return language.t("common.requestFailed")
    const count = workspaceSessions(workspace).length
    return language.plural("settings.workspaces.sessions", count, {
      count,
      project: projectName(workspace.project),
    })
  }
  const lastActive = (workspace: Workspace) => {
    const updated = workspaceSessions(workspace)[0]?.time.updated
    if (!updated) return undefined
    return getRelativeTime(new Date(updated).toISOString(), language.t)
  }
  const sessionTime = (session: SessionInfo) => {
    if (!session.time.updated) return undefined
    return getRelativeTime(new Date(session.time.updated).toISOString(), language.t)
  }

  const inspect = async (workspace: Workspace, context = captureDeleteContext()) => {
    const [working, branch, sessions] = await Promise.all([
      context.sdk.api.vcs.status({ location: { directory: workspace.directory } }),
      context.sdk.api.vcs.diff({ location: { directory: workspace.directory }, mode: "branch" }),
      loadSessions(context),
    ])
    const result = inspectWorkspaceDeletion({
      workspace: workspace.directory,
      activeDirectory: context.activeDirectory,
      sessions,
      status: working.data.length > 0 || branch.data.length > 0 ? "dirty" : "clean",
    })
    return { result, sessions }
  }
  const inspectionMessages = (result: WorkspaceDeleteInspection) => {
    const messages = [
      result.active ? language.t("settings.workspaces.delete.blocked.active") : undefined,
      result.linked ? language.t("settings.workspaces.delete.blocked.linked") : undefined,
      result.dirty ? language.t("workspace.status.dirty") : undefined,
    ].filter((message): message is string => message !== undefined)
    return messages.length > 0 ? messages : [language.t("workspace.status.clean")]
  }
  const blocked = (result: WorkspaceDeleteInspection) => {
    showToast({
      variant: "error",
      title: language.t("workspace.delete.failed.title"),
      description: inspectionMessages(result)[0],
    })
  }

  const remove = async (workspace: Workspace, force = false, context = captureDeleteContext()) => {
    const preflight = await inspect(workspace, context)
    if (preflight.result.active || (!force && (preflight.result.linked || preflight.result.dirty))) {
      blocked(preflight.result)
      return
    }
    const removed = await context.sdk.api.worktree
      .remove({
        projectID: workspace.project.id,
        directory: workspace.directory,
        force,
      })
      .then(() => true)
      .catch((error) => {
        showToast({
          variant: "error",
          title: language.t("workspace.delete.failed.title"),
          description: error instanceof Error ? error.message : language.t("common.requestFailed"),
        })
        return false
      })
    if (!removed) return
    tabs.store.forEach((tab) => {
      if (tab.type !== "draft" || tab.server !== context.server) return
      const directoryMatches = containsDirectory(workspace.directory, tab.directory)
      const worktreeMatches = tab.worktree && containsDirectory(workspace.directory, tab.worktree)
      if (!directoryMatches && !worktreeMatches) return
      tabs.updateDraft(tab.draftID, {
        directory: directoryMatches ? workspace.project.worktree : tab.directory,
        worktree: undefined,
      })
    })
    clearWorkspaceTerminals(workspace.directory, platform, context.sdk.scope)
    await projectQuery.refetch()
  }

  let inspectionID = 0
  const releaseConfirmation = () => {
    if (store.transaction === "confirm") setStore("transaction", undefined)
  }
  const transact = async (task: () => Promise<void>) => {
    if (store.transaction !== "confirm") return
    setStore("transaction", "running")
    try {
      await task()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("workspace.delete.failed.title"),
        description: error instanceof Error ? error.message : language.t("common.requestFailed"),
      })
    } finally {
      setStore("transaction", undefined)
    }
  }
  const confirmDelete = (workspace: Workspace) => {
    if (store.transaction) return
    const context = captureDeleteContext()
    const current = ++inspectionID
    setStore("transaction", "confirm")
    void dialog.push(
      () => (
        <DialogDeleteWorkspace
          workspace={workspace}
          scope={context.sdk.scope}
          inspectionID={current}
          inspect={() => inspect(workspace, context)}
          inspectionMessages={inspectionMessages}
          onDelete={() => transact(() => remove(workspace, true, context))}
        />
      ),
      releaseConfirmation,
    )
  }
  const removeAll = async (inventory: Workspace[], context: ReturnType<typeof captureDeleteContext>) => {
    await removeWorkspacesSequentially(inventory, (workspace) => remove(workspace, false, context))
  }
  const confirmDeleteAll = () => {
    if (store.transaction) return
    const context = captureDeleteContext()
    const inventory = [...filtered()]
    const project = projectOptions().find((option) => option.id === selectedProject())?.label ?? selectedProject()
    setStore("transaction", "confirm")
    void dialog.push(
      () => (
        <DialogDeleteAllWorkspaces
          count={inventory.length}
          project={project}
          onDelete={() => transact(() => removeAll(inventory, context))}
        />
      ),
      releaseConfirmation,
    )
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-workspaces-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.tab.workspaces")}</h2>
          <InlineServerSelect />
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-workspaces">
        <div class="settings-v2-workspaces-toolbar">
          <span class="settings-v2-workspaces-count">
            {language.plural("settings.workspaces.count", filtered().length)}
          </span>
          <div class="settings-v2-workspaces-toolbar-actions">
            <Show when={projects().length > 1}>
              <Menu placement="bottom-end" gutter={6}>
                <Menu.Trigger class="flex h-6 max-w-48 items-center gap-1 rounded-sm px-2 text-13-medium hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed">
                  <span class="min-w-0 truncate">
                    {projectOptions().find((option) => option.id === selectedProject())?.label}
                  </span>
                  <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content>
                    <For each={projectOptions()}>
                      {(option) => (
                        <Menu.Item onSelect={() => setStore("project", option.id)}>
                          <span class="min-w-0 flex-1 truncate">{option.label}</span>
                          <Show when={selectedProject() === option.id}>
                            <Icon name="check" size="small" class="shrink-0" />
                          </Show>
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </Show>
            <Show when={filtered().length > 0}>
              <Menu placement="bottom-end" gutter={4}>
                <Menu.Trigger
                  as={IconButton}
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("common.moreOptions")}
                  disabled={!!store.transaction}
                  icon={<Icon name="outline-dots" size="small" />}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Item onSelect={confirmDeleteAll}>
                      <span class="settings-v2-workspaces-delete-all">
                        {language.t("settings.workspaces.deleteAll")}
                      </span>
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </Show>
          </div>
        </div>

        <div class="settings-v2-workspaces-inventory">
          <Show
            when={filtered().length > 0}
            fallback={<div class="settings-v2-workspaces-empty">{language.t("settings.workspaces.empty")}</div>}
          >
            <SettingsListV2>
              <For each={filtered()}>
                {(workspace) => {
                  const linked = () => workspaceSessions(workspace)
                  return (
                    <div class="settings-v2-workspaces-row">
                      <div class="settings-v2-workspaces-row-header">
                        <div class="settings-v2-workspaces-copy">
                          <div class="settings-v2-workspaces-main">
                            <Tooltip
                              value={workspace.directory}
                              placement="top-start"
                              contentClass="max-w-[calc(100vw-32px)] break-all"
                            >
                              <span
                                tabIndex={0}
                                dir="ltr"
                                aria-label={workspace.directory}
                                class="settings-v2-workspaces-path"
                              >
                                {workspace.directory}
                              </span>
                            </Tooltip>
                          </div>
                          <span class="settings-v2-workspaces-meta">{sessionCount(workspace)}</span>
                        </div>
                        <div class="settings-v2-workspaces-row-actions">
                          <Show when={lastActive(workspace)}>
                            {(value) => (
                              <Tooltip value={language.t("settings.workspaces.lastActiveSession")} placement="top-end">
                                <span tabIndex={0} class="settings-v2-workspaces-active">
                                  {value()}
                                </span>
                              </Tooltip>
                            )}
                          </Show>
                          <IconButton
                            type="button"
                            variant="ghost-muted"
                            size="small"
                            aria-label={language.t("workspace.delete.confirm", {
                              name: getFilename(workspace.directory),
                            })}
                            disabled={!!store.transaction}
                            icon={<Icon name="trash" size="small" />}
                            onClick={() => confirmDelete(workspace)}
                          />
                        </div>
                      </div>
                      <Show when={linked().length > 0}>
                        <div class="settings-v2-workspaces-sessions">
                          <For each={linked()}>
                            {(session) => (
                              <div class="settings-v2-workspaces-session">
                                <span>{sessionLabel(session)}</span>
                                <Show when={sessionTime(session)}>
                                  {(time) => <span class="settings-v2-workspaces-session-time">{time()}</span>}
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </SettingsListV2>
          </Show>
        </div>
      </div>
    </>
  )
}

function DialogDeleteAllWorkspaces(props: { count: number; project: string; onDelete: () => Promise<void> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const remove = () => {
    const deleting = props.onDelete()
    dialog.close()
    void deleting
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.workspaces.deleteAll")}
          description={
            <>
              {language.t("settings.workspaces.deleteAll.confirm", { count: props.count })}
              <br />
              {language.t("settings.workspaces.deleteAll.warning", { count: props.count, project: props.project })}
            </>
          }
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="danger" onClick={remove}>
          {language.t("settings.workspaces.deleteAll")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function DialogDeleteWorkspace(props: {
  workspace: Workspace
  scope: ServerScope
  inspectionID: number
  inspect: () => Promise<{ result: WorkspaceDeleteInspection; sessions: SessionInfo[] }>
  inspectionMessages: (result: WorkspaceDeleteInspection) => string[]
  onDelete: () => Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const status = useQuery(() => ({
    queryKey: [props.scope, pathKey(props.workspace.directory), "workspace-delete-status", props.inspectionID] as const,
    queryFn: props.inspect,
    staleTime: 0,
  }))
  const descriptions = () => {
    if (status.isPending) return [language.t("workspace.status.checking")]
    if (status.isError) return [language.t("workspace.status.error")]
    if (!status.data) return []
    return props.inspectionMessages(status.data.result)
  }
  const remove = () => {
    const deleting = props.onDelete()
    dialog.close()
    void deleting
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("workspace.delete.title")}
          description={
            <>
              {language.t("workspace.delete.confirm", { name: getFilename(props.workspace.directory) })}
              <br />
              <code class="max-w-full rounded-[4px] bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-v2-text-text-base break-all">
                {props.workspace.directory}
              </code>
              <br />
              {language.t("settings.workspaces.delete.warning")}
              <For each={descriptions()}>{(description) => <div>{description}</div>}</For>
            </>
          }
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={status.isPending || status.isError || status.data?.result.active}
          onClick={remove}
        >
          {language.t("workspace.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
