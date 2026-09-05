import type { Component } from "solid-js"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { useQueries, useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Menu } from "@opencode-ai/ui/menu"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { getRelativeTime } from "@/shell/time"
import { sessionLabel } from "@/session/title"
import { pathKey } from "@/workspaces/path-key"
import { SettingsList } from "@/settings/list"
import { InlineServerSelect } from "@/settings/server-select"
import { useTabs } from "@/shell/tabs/tabs"
import { usePlatform } from "@/runtime/platform/platform"
import { clearWorkspaceTerminals } from "@/session/terminal/context"
import { ServerConnection } from "@/runtime/server/registry"
import type { Project } from "@/runtime/server/types"
import {
  containsDirectory,
  filterWorkspaceInventory,
  inspectWorkspaceDeletion,
  mergeWorkspaceSessionInventory,
  removeWorkspacesSequentially,
  sessionsForWorkspace,
  type WorkspaceDeleteInspection,
  workspaceInventory,
} from "@/workspaces/paths"
import { listAllSessions } from "@/session/list"
import type { ServerScope } from "@/runtime/server/scope"
import { loadProjectsQuery } from "@/runtime/server/global-sync/bootstrap"
import { withWorktreeInventory, worktreeInventoryKey } from "@/workspaces/inventory"
import "@/settings/settings.css"

type Workspace = {
  directory: string
  project: Project
}

export const SettingsWorkspaces: Component<{ activeDirectory?: string }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const server = useServer()
  const data = useData()
  const tabs = useTabs()
  const platform = usePlatform()
  const [store, setStore] = createStore({
    project: "all",
    transaction: undefined as "confirm" | "running" | undefined,
  })

  const projectQuery = useQuery(() => ({
    ...loadProjectsQuery(serverSDK.scope, serverSDK.api.project),
    enabled: serverSDK.connection.status() === "connected",
    refetchOnMount: "always",
  }))
  const projects = createMemo(() => [
    ...new Map(
      (projectQuery.data ?? []).map((project) => [worktreeInventoryKey(serverSDK.scope, project.worktree)[2], project]),
    ).values(),
  ])
  const projectName = (project: Project) => project.name || getFilename(project.worktree)
  const projectOptions = createMemo(() => [
    { id: "all", label: language.t("settings.workspaces.filter.all") },
    ...projects().map((project) => ({ id: project.id, label: projectName(project) })),
  ])
  const selectedProject = createMemo(() =>
    store.project === "all" || projects().some((project) => project.id === store.project) ? store.project : "all",
  )
  const requested = createMemo(() =>
    projects().filter((project) => selectedProject() === "all" || project.id === selectedProject()),
  )
  const inventoryQueries = useQueries(() => ({
    queries: requested().map((project) => ({
      ...server.ctx.sync.worktrees.query(project.worktree),
      enabled: serverSDK.connection.status() === "connected",
    })),
  }))
  const inventory = createMemo(() =>
    requested().map((project, index) => withWorktreeInventory(project, inventoryQueries[index]?.data)),
  )
  const loading = () => projectQuery.isPending || inventoryQueries.some((query) => query.isPending)
  const failed = () => projectQuery.isError || inventoryQueries.some((query) => query.isError)
  const workspaces = createMemo(() => workspaceInventory(inventory()))
  const filtered = createMemo(() => filterWorkspaceInventory(workspaces(), selectedProject()))
  const captureDeleteContext = () => {
    const sdk = serverSDK
    return {
      sdk,
      data,
      worktrees: server.ctx.sync.worktrees,
      server: ServerConnection.key(sdk.server),
      activeDirectory: props.activeDirectory,
    }
  }
  // Fetch sessions per workspace directory instead of paging through every session on the server.
  const loadSessions = async (directories: readonly string[], context = captureDeleteContext()) => {
    const fetched = await Promise.all(
      directories.map((directory) => listAllSessions(context.sdk.api.session, { order: "desc", directory })),
    )
    const sessions = fetched.flat()
    return mergeWorkspaceSessionInventory(sessions, context.data.session.list())
  }
  const workspaceDirectories = createMemo(() => workspaces().map((workspace) => workspace.directory))
  const sessionQuery = useQuery(() => ({
    queryKey: [
      serverSDK.scope,
      null,
      "settings-workspace-sessions",
      workspaceDirectories().map((directory) => String(pathKey(directory))),
    ] as const,
    queryFn: () => loadSessions(workspaceDirectories()),
    enabled: serverSDK.connection.status() === "connected" && !loading() && workspaceDirectories().length > 0,
    refetchOnMount: "always",
  }))
  const sessionsByWorkspace = createMemo(() => {
    const sessions = sessionQuery.isPending ? [] : (sessionQuery.data ?? [])
    return new Map(
      workspaces().map((workspace) => [
        pathKey(workspace.directory),
        sessionsForWorkspace(sessions, workspace.directory),
      ]),
    )
  })
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
      loadSessions([workspace.directory], context),
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
        location: { directory: workspace.project.worktree },
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
    await context.worktrees.invalidate(workspace.project.worktree)
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
      <div class="settings-tab-header settings-workspaces-header">
        <div class="settings-tab-header-row">
          <h2 class="settings-tab-title">{language.t("settings.tab.workspaces")}</h2>
          <InlineServerSelect />
        </div>
      </div>

      <div class="settings-tab-body settings-workspaces">
        <div class="settings-workspaces-toolbar">
          <span class="settings-workspaces-count">
            <Show when={!loading() && !failed()}>
              {language.plural("settings.workspaces.count", filtered().length)}
            </Show>
          </span>
          <div class="settings-workspaces-toolbar-actions">
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
                  disabled={!!store.transaction || loading() || failed()}
                  icon={<Icon name="outline-dots" size="small" />}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Item onSelect={confirmDeleteAll}>
                      <span class="settings-workspaces-delete-all">{language.t("settings.workspaces.deleteAll")}</span>
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </Show>
          </div>
        </div>

        <div class="settings-workspaces-inventory">
          <Show when={filtered().length > 0 && (loading() || failed())}>
            <div class="settings-workspaces-empty" role="status">
              {language.t(failed() ? "common.requestFailed" : "common.loading")}
            </div>
          </Show>
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="settings-workspaces-empty">
                {language.t(
                  loading() ? "common.loading" : failed() ? "common.requestFailed" : "settings.workspaces.empty",
                )}
              </div>
            }
          >
            <SettingsList>
              <For each={filtered()}>
                {(workspace) => {
                  const linked = () => workspaceSessions(workspace)
                  return (
                    <div class="settings-workspaces-row">
                      <div class="settings-workspaces-row-header">
                        <div class="settings-workspaces-copy">
                          <div class="settings-workspaces-main">
                            <Tooltip
                              value={workspace.directory}
                              placement="top-start"
                              contentClass="max-w-[calc(100vw-32px)] break-all"
                            >
                              <span
                                tabIndex={0}
                                dir="ltr"
                                aria-label={workspace.directory}
                                class="settings-workspaces-path"
                              >
                                {workspace.directory}
                              </span>
                            </Tooltip>
                          </div>
                          <span class="settings-workspaces-meta">{sessionCount(workspace)}</span>
                        </div>
                        <div class="settings-workspaces-row-actions">
                          <Show when={lastActive(workspace)}>
                            {(value) => (
                              <Tooltip value={language.t("settings.workspaces.lastActiveSession")} placement="top-end">
                                <span tabIndex={0} class="settings-workspaces-active">
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
                        <div class="settings-workspaces-sessions">
                          <For each={linked()}>
                            {(session) => (
                              <div class="settings-workspaces-session">
                                <span>{sessionLabel(session)}</span>
                                <Show when={sessionTime(session)}>
                                  {(time) => <span class="settings-workspaces-session-time">{time()}</span>}
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
            </SettingsList>
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
