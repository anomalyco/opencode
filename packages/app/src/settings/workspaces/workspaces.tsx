import type { Component, JSX } from "solid-js"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Key } from "@solid-primitives/keyed"
import type { SessionInfo } from "@opencode/client/promise"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
import { containsDirectory, getFilename } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { getRelativeTime } from "@/shell/time"
import { sessionLabel } from "@/session/title"
import { pathKey } from "@/workspaces/path-key"
import { worktreeInventoryKey } from "@/workspaces/inventory"
import { SettingsList } from "@/settings/list"
import { useTabs } from "@/shell/tabs/tabs"
import { useHostApis } from "@/runtime/plugin/root"
import { ServerConnection } from "@/runtime/server/registry"
import type { Project } from "@/runtime/server/types"
import {
  filterWorkspaceInventory,
  inspectWorkspaceDeletion,
  managedWorkspaceDirectories,
  mergeWorkspaceSessionInventory,
  sessionsForWorkspace,
  type WorkspaceDeleteInspection,
  workspaceInventory,
} from "@/workspaces/paths"
import { listAllSessions } from "@/session/list"
import {
  createWorkspaceDeleteState,
  isWorkspaceDeleteBusy,
  transitionWorkspaceDelete,
  visibleWorkspaces,
  workspaceConfirmView,
  workspaceRowView,
  type WorkspaceDeleteEffect,
  type WorkspaceDeleteEvent,
  type WorkspaceDeleteScope,
  type WorkspaceSkipReason,
  type WorkspaceTarget,
} from "./delete-machine"
import { workspaceInventoryQuery } from "./queries"
import "@/settings/settings.css"

type Workspace = {
  directory: string
  project: Project
}

export const SettingsWorkspaces: Component<{
  activeDirectory?: string
  resetProjectFilter?: () => number
  projectID?: string
  headerAction?: JSX.Element
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()
  const serverSDK = server.ctx.sdk
  const queryClient = useQueryClient()
  const data = server.ctx.data
  const tabs = useTabs()
  const hostApis = useHostApis()

  const [projectFilter, setProjectFilter] = createSignal("all")
  const [deleteState, setDeleteState] = createSignal(createWorkspaceDeleteState())
  const busy = () => isWorkspaceDeleteBusy(deleteState())

  createEffect(() => {
    if (props.projectID) {
      setProjectFilter(props.projectID)

      return
    }

    props.resetProjectFilter?.()
    setProjectFilter("all")
  })

  const projectQuery = useQuery(() => ({
    ...workspaceInventoryQuery(server.ctx, queryClient, props.projectID),
    enabled: serverSDK.connection.status() === "connected",
    refetchOnMount: true,
  }))

  const inventory = createMemo(() => (projectQuery.isPending ? [] : (projectQuery.data ?? [])))
  const workspaces = createMemo(() => workspaceInventory(inventory()))
  const projects = createMemo(() => inventory().filter((project) => managedWorkspaceDirectories(project).length > 0))
  const projectName = (project: Project) => project.name || getFilename(project.worktree)

  const projectOptions = createMemo(() => [
    { id: "all", label: language.t("settings.workspaces.filter.all") },
    ...projects().map((project) => ({ id: project.id, label: projectName(project) })),
  ])

  const selectedProject = createMemo(() =>
    props.projectID
      ? props.projectID
      : projectFilter() === "all" || projects().some((project) => project.id === projectFilter())
        ? projectFilter()
        : "all",
  )

  const workspaceKey = (workspace: Workspace) => String(pathKey(workspace.directory))

  const filtered = createMemo(() =>
    visibleWorkspaces(deleteState(), filterWorkspaceInventory(workspaces(), selectedProject()), workspaceKey),
  )

  // Fetch sessions per workspace directory instead of paging through every session on the server.
  const loadSessions = async (directories: readonly string[], signal?: AbortSignal) => {
    const fetched = await Promise.all(
      directories.map((directory) =>
        listAllSessions(serverSDK.api.session, { order: "desc", directory }, { signal }),
      ),
    )

    const sessions = fetched.flat()

    return mergeWorkspaceSessionInventory(sessions, data.session.list())
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
    enabled: serverSDK.connection.status() === "connected" && workspaceDirectories().length > 0,
    placeholderData: (previous) => previous,
    refetchOnMount: "always",
  }))

  const sessionsByWorkspace = createMemo(() => {
    const sessions = mergeWorkspaceSessionInventory(
      sessionQuery.isPending ? [] : (sessionQuery.data ?? []),
      data.session.list(),
    )

    return new Map(
      workspaces().map((workspace) => [
        pathKey(workspace.directory),
        sessionsForWorkspace(sessions, workspace.directory),
      ]),
    )
  })

  const workspaceSessions = (workspace: Workspace) => sessionsByWorkspace().get(pathKey(workspace.directory)) ?? []

  const workspacesWithoutSessions = createMemo(() => {
    if (sessionQuery.isPending || sessionQuery.isError || sessionQuery.isPlaceholderData) return []

    return filtered().filter((workspace) => workspaceSessions(workspace).length === 0)
  })

  const sessionCount = (workspace: Workspace) => {
    const count = workspaceSessions(workspace).length

    if (!count && sessionQuery.isPending) return language.t("session.messages.loading")

    if (!count && sessionQuery.isError) return language.t("common.requestFailed")

    if (selectedProject() !== "all") return language.plural("settings.workspaces.sessions.filtered", count, { count })
    const project = projectName(workspace.project)

    const label = language.plural("settings.workspaces.sessions", count, {
      count,
      project,
    })

    const start = label.lastIndexOf(project)

    if (start < 0) return label

    return (
      <>
        {label.slice(0, start)}
        <span class="settings-workspaces-meta-project">{project}</span>
        {label.slice(start + project.length)}
      </>
    )
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

  const inspect = async (directory: string, active: string | undefined, signal?: AbortSignal) => {
    const [working, branch, sessions] = await Promise.all([
      serverSDK.api.vcs.status({ location: { directory } }, { signal }),
      serverSDK.api.vcs.diff({ location: { directory }, mode: "branch" }, { signal }),
      loadSessions([directory], signal),
    ])

    return inspectWorkspaceDeletion({
      workspace: directory,
      activeDirectory: active,
      sessions,
      status: working.data.length > 0 || branch.data.length > 0 ? "dirty" : "clean",
    })
  }

  const inspectionMessages = (result: WorkspaceDeleteInspection) => {
    const messages = [
      result.linked ? language.t("settings.workspaces.delete.blocked.linked") : undefined,
      result.dirty ? language.t("workspace.status.dirty") : undefined,
    ].filter((message): message is string => message !== undefined)

    return messages
  }

  const skippedMessage = (reason: WorkspaceSkipReason) => {
    if (reason.kind === "blocked")
      return reason.inspection.active
        ? language.t("settings.workspaces.delete.blocked.active")
        : inspectionMessages(reason.inspection)[0]

    if (reason.kind === "failed") return reason.message ?? language.t("common.requestFailed")

    return language.t("common.requestFailed")
  }

  // A bulk delete checks each worktree first; a single one was checked in its confirmation and deletes with force.
  const removeWorkspace = async (effect: Extract<WorkspaceDeleteEffect, { type: "delete.run" }>) => {
    const target = effect.target

    if (!effect.force) {
      const preflight = await inspect(target.directory, effect.active)

      if (preflight.active || preflight.linked || preflight.dirty)
        return dispatch({
          type: "delete.skipped",
          attempt: effect.attempt,
          reason: { kind: "blocked", inspection: preflight },
        })
    }

    await serverSDK.api.worktree.remove({
      projectID: target.projectID,
      directory: target.directory,
      force: effect.force,
    })
    dispatch({ type: "delete.succeeded", attempt: effect.attempt, target })
  }

  const deleteTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const checks = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  let collapseTimer: ReturnType<typeof setTimeout> | undefined
  const serverKey = ServerConnection.key(serverSDK.server)

  const dispatch = (event: WorkspaceDeleteEvent) => {
    const previous = untrack(deleteState)
    const next = transitionWorkspaceDelete(previous, event)

    if (next.state !== previous) setDeleteState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: WorkspaceDeleteEffect) => {
    if (effect.type === "open.confirm") return openConfirm(effect)

    if (effect.type === "inspect.run") {
      const attempt = effect.attempt
      const controller = new AbortController()
      checks.set(attempt, {
        controller,
        timer: setTimeout(() => dispatch({ type: "inspect.timed-out", attempt }), effect.timeoutMs),
      })
      void inspect(effect.directory, effect.active, controller.signal).then(
        (inspection) => dispatch({ type: "inspect.succeeded", attempt, inspection }),
        () => dispatch({ type: "inspect.failed", attempt }),
      )

      return
    }

    if (effect.type === "inspect.stop") {
      const check = checks.get(effect.attempt)
      checks.delete(effect.attempt)
      clearTimeout(check?.timer)
      check?.controller.abort()

      return
    }

    if (effect.type === "delete.run") {
      const attempt = effect.attempt
      deleteTimers.set(
        attempt,
        setTimeout(() => dispatch({ type: "delete.timed-out", attempt }), effect.timeoutMs),
      )
      void removeWorkspace(effect).catch((error) =>
        dispatch({
          type: "delete.skipped",
          attempt,
          reason: { kind: "failed", message: error instanceof Error ? error.message : undefined },
        }),
      )

      return
    }

    if (effect.type === "delete.timer.stop") {
      clearTimeout(deleteTimers.get(effect.attempt))
      deleteTimers.delete(effect.attempt)

      return
    }

    if (effect.type === "collapse.start") {
      const attempt = effect.attempt
      collapseTimer = setTimeout(() => dispatch({ type: "collapse.completed", attempt }), effect.delayMs)

      return
    }

    if (effect.type === "collapse.cancel") return clearTimeout(collapseTimer)

    if (effect.type === "toast.skipped")
      return showToast({
        variant: "error",
        title: language.t("workspace.delete.failed.title"),
        description: skippedMessage(effect.reason),
      })

    const target = effect.target
    tabs.store.forEach((tab) => {
      if (tab.type !== "draft" || tab.server !== serverKey) return
      const directoryMatches = containsDirectory(target.directory, tab.directory)
      const worktreeMatches = tab.worktree && containsDirectory(target.directory, tab.worktree)

      if (!directoryMatches && !worktreeMatches) return
      tabs.updateDraft(tab.draftID, {
        directory: directoryMatches ? target.projectWorktree : tab.directory,
        worktree: undefined,
      })
    })
    hostApis.workspaceRemoved({ server: serverKey, directory: target.directory })
    void queryClient.invalidateQueries({ queryKey: worktreeInventoryKey(serverSDK.scope, target.projectID) })
    void queryClient.invalidateQueries({ queryKey: [serverSDK.scope, "settings-workspace-inventory"] })
  }

  const openConfirm = (effect: Extract<WorkspaceDeleteEffect, { type: "open.confirm" }>) => {
    const attempt = effect.attempt
    const accept = () => dispatch({ type: "confirm.accepted", attempt })
    // A closing dialog reports this after its exit animation, which the attempt makes harmless for the next one.
    const cancel = () => dispatch({ type: "confirm.cancelled", attempt })
    const target = effect.targets[0]

    if (effect.scope === "one" && target) {
      void dialog.push(
        () => (
          <DialogDeleteWorkspace
            directory={target.directory}
            view={workspaceConfirmView(deleteState(), attempt)}
            inspectionMessages={inspectionMessages}
            onRetry={() => dispatch({ type: "inspect.retried", attempt })}
            onDelete={accept}
          />
        ),
        cancel,
      )

      return
    }

    const copy =
      effect.scope === "unused"
        ? {
            title: language.t("settings.workspaces.deleteWithoutSessions"),
            confirmation: language.plural("settings.workspaces.deleteWithoutSessions.confirm", effect.targets.length),
            warning: language.t("settings.workspaces.deleteWithoutSessions.warning"),
          }
        : {
            title: language.t("settings.workspaces.deleteAll"),
            confirmation: language.plural("settings.workspaces.deleteAll.confirm", effect.targets.length),
            warning: language.t("settings.workspaces.deleteAll.warning"),
          }

    void dialog.push(
      () => (
        <DialogDeleteWorkspaces
          title={copy.title}
          confirmation={copy.confirmation}
          warning={copy.warning}
          onDelete={accept}
        />
      ),
      cancel,
    )
  }

  const targetOf = (workspace: Workspace): WorkspaceTarget => ({
    key: workspaceKey(workspace),
    directory: workspace.directory,
    projectID: workspace.project.id,
    projectWorktree: workspace.project.worktree,
  })

  const confirm = (scope: WorkspaceDeleteScope, inventory: readonly Workspace[]) =>
    dispatch({ type: "confirm.opened", scope, active: props.activeDirectory, targets: inventory.map(targetOf) })

  createEffect(() => dispatch({ type: "inventory.synced", keys: workspaces().map(workspaceKey) }))
  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <>
      <div class="settings-tab-header settings-workspaces-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.workspaces")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.workspaces.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <div class="settings-tab-body settings-workspaces">
        <Show when={filtered().length > 0}>
          <div class="settings-workspaces-toolbar">
            <span class="settings-section-title">
              {language.plural("settings.workspaces.count", filtered().length)}
            </span>
            <div class="settings-workspaces-toolbar-actions">
              <Show when={!props.projectID && projects().length > 1}>
                <Menu placement="bottom-end" gutter={6}>
                  <Menu.Trigger as={Button} size="small" variant="ghost-muted" class="max-w-48">
                    <span class="min-w-0 truncate">
                      {projectOptions().find((option) => option.id === selectedProject())?.label}
                    </span>
                    <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content>
                      <For each={projectOptions()}>
                        {(option) => (
                          <Menu.Item onSelect={() => setProjectFilter(option.id)}>
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
              <Menu placement="bottom-end" gutter={4}>
                <Menu.Trigger
                  as={IconButton}
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("common.moreOptions")}
                  disabled={busy()}
                  icon={<Icon name="outline-dots" size="small" />}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Show when={workspacesWithoutSessions().length > 0}>
                      <Menu.Item onSelect={() => confirm("unused", workspacesWithoutSessions())}>
                        {language.t("settings.workspaces.deleteWithoutSessions")}
                      </Menu.Item>
                      <Menu.Separator />
                    </Show>
                    <Menu.Item onSelect={() => confirm("all", filtered())}>
                      <span class="settings-workspaces-delete-all">{language.t("settings.workspaces.deleteAll")}</span>
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </div>
          </div>
        </Show>

        <div class="settings-workspaces-inventory" data-empty={filtered().length === 0}>
          <SettingsList>
            <div class="settings-workspaces-empty-motion" data-visible={filtered().length === 0}>
              <div class="settings-workspaces-empty">
                <Show
                  when={!projectQuery.isPending && !projectQuery.isError}
                  fallback={language.t(projectQuery.isPending ? "common.loading" : "common.requestFailed")}
                >
                  <span class="settings-workspaces-empty-title">{language.t("settings.workspaces.empty")}</span>
                  <span>{language.t("settings.workspaces.empty.description")}</span>
                </Show>
              </div>
            </div>
            <Key each={filtered()} by={(workspace) => `${workspace.project.id}:${pathKey(workspace.directory)}`}>
              {(workspace) => {
                const linked = () => workspaceSessions(workspace())
                const row = () => workspaceRowView(deleteState(), workspaceKey(workspace()))
                const deleting = () => row().deleting

                return (
                  <div class="settings-workspaces-row-motion" data-removing={row().collapsing}>
                    <div class="settings-workspaces-row">
                      <div class="settings-workspaces-row-header">
                        <div class="settings-workspaces-copy">
                          <div class="settings-workspaces-main">
                            <WorkspacePath directory={workspace().directory} />
                          </div>
                          <span class="settings-workspaces-meta">{sessionCount(workspace())}</span>
                        </div>
                        <div class="settings-workspaces-row-actions">
                          <Show
                            when={deleting()}
                            fallback={
                              <>
                                <Show when={lastActive(workspace())}>
                                  {(value) => (
                                    <Tooltip
                                      value={language.t("settings.workspaces.lastActiveSession")}
                                      placement="top-end"
                                    >
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
                                    name: getFilename(workspace().directory),
                                  })}
                                  disabled={busy()}
                                  icon={<Icon name="outline-trash" size="small" />}
                                  onClick={() => confirm("one", [workspace()])}
                                />
                              </>
                            }
                          >
                            <span class="settings-workspaces-active">{language.t("workspace.lifecycle.deleting")}</span>
                          </Show>
                        </div>
                      </div>
                      <Show when={linked().length > 0}>
                        <div class="settings-workspaces-sessions">
                          <For each={linked()}>
                            {(session) => (
                              <div class="settings-workspaces-session">
                                <span>{sessionLabel(session)}</span>
                                <Show when={linked().length > 1 ? sessionTime(session) : undefined}>
                                  {(time) => <span class="settings-workspaces-session-time">{time()}</span>}
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </Key>
          </SettingsList>
        </div>
      </div>
    </>
  )
}

function WorkspacePath(props: { directory: string }) {
  const [truncated, setTruncated] = createSignal(false)
  const name = () => getFilename(props.directory)

  return (
    <Tooltip
      value={props.directory}
      placement="top-start"
      disabled={!truncated()}
      contentClass="max-w-[calc(100vw-32px)] break-all"
    >
      <span
        ref={(element) => createResizeObserver(element, () => setTruncated(element.scrollWidth > element.clientWidth))}
        tabIndex={truncated() ? 0 : undefined}
        dir="ltr"
        aria-label={props.directory}
        class="settings-workspaces-path"
      >
        <span>{props.directory.slice(0, -name().length)}</span>
        <span class="settings-workspaces-path-name">{name()}</span>
      </span>
    </Tooltip>
  )
}

function DialogDeleteWorkspaces(props: { title: string; confirmation: string; warning: string; onDelete: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  const remove = () => {
    props.onDelete()
    dialog.close()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={props.title}
          description={
            <div class="flex flex-col gap-2">
              <div>{props.confirmation}</div>
              <div>{props.warning}</div>
            </div>
          }
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="danger" onClick={remove}>
          {language.t("settings.workspaces.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function DialogDeleteWorkspace(props: {
  directory: string
  view: ReturnType<typeof workspaceConfirmView>
  inspectionMessages: (result: WorkspaceDeleteInspection) => string[]
  onRetry: () => void
  onDelete: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const descriptions = () => {
    if (props.view.failed) return [language.t("workspace.status.error")]

    if (!props.view.inspection) return []

    return props.inspectionMessages(props.view.inspection)
  }

  const remove = () => {
    props.onDelete()
    dialog.close()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("workspace.delete.confirm", { name: getFilename(props.directory) })}
          description={
            <div class="flex flex-col gap-2">
              <div class="flex flex-col gap-1">
                <span class="text-11-regular text-v2-text-text-faint">
                  {language.t(props.view.checking ? "workspace.status.checking" : "workspace.delete.location")}
                </span>
                <code class="block w-fit max-w-full rounded-[4px] bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-v2-text-text-base break-all">
                  {props.directory}
                </code>
              </div>
              <div>{language.t("settings.workspaces.delete.warning")}</div>
              <For each={descriptions()}>{(description) => <div>{description}</div>}</For>
            </div>
          }
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Show when={props.view.failed}>
          <Button type="button" variant="neutral" onClick={() => props.onRetry()}>
            {language.t("common.retry")}
          </Button>
        </Show>
        <Button type="button" variant="danger" disabled={!props.view.canDelete} onClick={remove}>
          {language.t("workspace.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
