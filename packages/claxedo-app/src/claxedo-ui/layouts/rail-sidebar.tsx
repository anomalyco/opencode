/**
 * Rail Sidebar Component
 *
 * Collapsible sidebar with Project > Session flat list.
 * - Collapsed: 56px wide, icons only
 * - Expanded: 260px wide, full list
 * - Shows 5 sessions per project by default, with "Load more" button
 *
 * Hover behavior:
 * - Mouse enters leftmost 12px: expand after 100ms
 * - Mouse leaves rail: collapse after 100ms
 * - Can be pinned open via toggle button
 */

import { For, Show, createMemo, createSignal, onCleanup, onMount, createEffect, type JSX } from "solid-js"
import { useClaxedoLayout } from "../context/claxedo-layout"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Avatar } from "@opencode-ai/ui/avatar"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { getAvatarColors, useLanguage, useGlobalSync, useServer } from "@opencode-ai/claxedo-app"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { StatusPopover } from "../../overrides/components/status-popover"
import { DialogEditProject } from "../components/dialog-edit-project"
import { getFilename } from "@opencode-ai/util/path"
import type { Session } from "@opencode-ai/sdk/v2"

export type SessionItem = {
  id: string
  title?: string
  time?: number
  directory?: string
}

export type WorkspaceItem = {
  id: string
  directory: string
  name?: string
  isMain?: boolean
  projectWorktree?: string
  isCloud?: boolean
  canDelete?: boolean
}

export type ProjectItem = {
  id: string
  worktree: string
  name?: string
  icon?: {
    url?: string
    override?: string
    color?: string
  }
  expanded?: boolean
  sandboxes?: string[]
  commands?: { start?: string }
}

export type RailSidebarProps = {
  projects: ProjectItem[]
  activeProjectId?: string
  activeWorkspaceId?: string
  activeSessionId?: string
  onProjectSelect?: (project: ProjectItem) => void
  onWorkspaceSelect?: (project: ProjectItem, workspaceDir: string) => void
  onSessionSelect?: (workspaceDir: string, sessionId: string) => void
  onNewSession?: (workspaceDir: string) => void
  onNewWorkspace?: (project: ProjectItem) => void
  onNewProject?: () => void
  onRemoveProject?: (project: ProjectItem) => void
  onDeleteWorkspace?: (workspace: WorkspaceItem) => void
  onDeleteSession?: (session: SessionItem) => void
  onArchiveSession?: (session: SessionItem) => void
  onSettings?: () => void
  onHelp?: () => void
  homedir?: string
  children?: JSX.Element
}

export function RailSidebar(props: RailSidebarProps) {
  const claxedo = useClaxedoLayout()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const server = useServer()
  const dialog = useDialog()
  let railRef: HTMLElement | undefined

  const expanded = createMemo(() => !claxedo.rail.collapsed() || claxedo.rail.pinned())
  const width = createMemo(() => claxedo.rail.width())

  // Track display limits per project for "load more"
  const [projectLimits, setProjectLimits] = createSignal<Record<string, number>>({})
  const getProjectLimit = (projectId: string) => projectLimits()[projectId] ?? 5

  // Get all sessions for a project (across all workspaces) - flat list
  const getProjectSessions = (project: ProjectItem): { sessions: SessionItem[]; total: number; directory: string } => {
    // Get all directories for this project (main + sandboxes)
    const directories = [project.worktree, ...(project.sandboxes ?? []).filter(s => s !== project.worktree)]

    // Collect all sessions from all workspaces
    const allSessions: SessionItem[] = []
    for (const dir of directories) {
      const [dirStore] = globalSync.child(dir)
      const sessions = (dirStore.session ?? [])
        .filter((s: Session) => s.directory === dir && !s.parentID && !s.time?.archived)
        .map((s: Session) => ({
          id: s.id,
          title: s.title || "New Session",
          time: s.time?.updated ?? s.time?.created,
          directory: dir // Track which workspace this session belongs to
        }))
      allSessions.push(...sessions)
    }

    // Sort by time descending
    const sorted = allSessions.toSorted((a, b) => (b.time ?? 0) - (a.time ?? 0))

    // Apply limit
    const limit = getProjectLimit(project.id)
    return {
      sessions: sorted.slice(0, limit),
      total: sorted.length,
      directory: project.worktree // Default directory for new sessions
    }
  }

  // Load more sessions for a project
  const loadMoreSessions = async (project: ProjectItem) => {
    const currentLimit = getProjectLimit(project.id)
    setProjectLimits(prev => ({ ...prev, [project.id]: currentLimit + 5 }))

    // Trigger reload of sessions from all workspaces
    const directories = [project.worktree, ...(project.sandboxes ?? []).filter(s => s !== project.worktree)]
    for (const dir of directories) {
      const [, setStore] = globalSync.child(dir)
      setStore("limit", (limit: number) => limit + 5)
      await globalSync.project.loadSessions(dir)
    }
  }

  // Handle hot zone detection + floating collapse via unified position tracking
  const handleMouseMove = (e: MouseEvent) => {
    if (!railRef) return
    const rect = railRef.getBoundingClientRect()
    claxedo.rail.trackPosition(e.clientX, e.clientY, { top: rect.top, right: rect.right, bottom: rect.bottom })
  }

  const handleMouseLeave = (e: MouseEvent) => {
    claxedo.rail.handleMouseLeave(e)
  }

  const handleMouseEnter = () => {
    claxedo.rail.cancelCollapse()
  }

  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove)
    onCleanup(() => {
      document.removeEventListener("mousemove", handleMouseMove)
    })
  })

  const ProjectIcon = (iconProps: { project: ProjectItem; active: boolean }) => {
    const name = createMemo(() => iconProps.project.name || getFilename(iconProps.project.worktree))
    const colors = createMemo(() => getAvatarColors(iconProps.project.icon?.color))

    return (
      <div class="relative shrink-0">
        <Avatar
          fallback={name()}
          src={iconProps.project.icon?.override}
          {...colors()}
          class="w-7 h-7 rounded-md text-xs"
        />
        <Show when={iconProps.active}>
          <div class="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-surface-interactive-base" />
        </Show>
      </div>
    )
  }

  return (
    <nav
      ref={railRef}
      class={`h-full flex flex-col bg-background-base shadow-lg overflow-hidden z-[50] pointer-events-auto
        transition-all duration-200 ease-out
        max-md:!w-[280px] max-md:opacity-100 max-md:pointer-events-auto max-md:translate-x-0
        ${claxedo.rail.pinned()
          ? "opacity-100 translate-x-0"
          : expanded()
            ? "opacity-100 translate-x-0 border-r border-border-base"
            : "md:opacity-0 md:-translate-x-2 md:pointer-events-none"}
      `}
      style={{ width: `${width()}px` }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label={language.t("sidebar.nav.projectsAndSessions")}
    >
      {/* Hot zone for hover detection */}
      <div class="fixed top-0 left-0 bottom-0 w-3 z-[60] pointer-events-none" />

      {/* Header - fixed at top */}
      <div class="h-10 flex items-center px-3 border-b border-border-weak-base shrink-0 box-content">
        {/* Collapsed view - hidden on mobile */}
        <div class={`w-full flex items-center justify-center ${expanded() ? "hidden" : "md:flex"} max-md:hidden`}>
          <Show when={props.projects[0]}>
            {(proj) => (
              <Tooltip placement="right" value={`${proj().name || getFilename(proj().worktree)} — ${props.homedir && proj().worktree.startsWith(props.homedir) ? "~" + proj().worktree.slice(props.homedir.length) : proj().worktree}`}>
                <div>
                  <button
                    type="button"
                    class="p-1 rounded-md hover:bg-surface-base-hover transition-colors"
                    onClick={() => props.onProjectSelect?.(proj())}
                  >
                    <ProjectIcon project={proj()} active={props.activeProjectId === proj().id} />
                  </button>
                </div>
              </Tooltip>
            )}
          </Show>
        </div>
        {/* Expanded view - always shown on mobile */}
        <div class={`flex items-center justify-end w-full pl-1 ${expanded() ? "flex" : "hidden"} max-md:flex`}>
          <Show when={!claxedo.rail.pinned()}>
            <Tooltip placement="bottom" value="Pin sidebar">
              <div class="max-md:hidden">
                <div class="flex items-center">
                  <IconButton
                    icon="layout-left-partial"
                    variant="ghost"
                    class="rounded"
                    onClick={() => claxedo.rail.toggle()}
                    aria-label="Pin sidebar"
                  />
                </div>
              </div>
            </Tooltip>
          </Show>
        </div>
      </div>

      {/* Scrollable content area */}
      <div
        class="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden rail-sidebar-scroll"
        style={{
          "scrollbar-width": "thin",
          "scrollbar-color": "rgba(128, 128, 128, 0.3) transparent",
        }}
      >
        {/* Projects list */}
        <div class="flex-1 flex flex-col py-2 gap-1">
          <For each={props.projects}>
            {(project) => {
              const isProjectActive = createMemo(() => props.activeProjectId === project.id)
              const [isProjectExpanded, setIsProjectExpanded] = createSignal(true)

              // Keep expanded when project becomes active
              createEffect(() => {
                if (isProjectActive()) setIsProjectExpanded(true)
              })

              return (
                <>
                  {/* Collapsed fallback - hidden on mobile */}
                  <div class={`${expanded() ? "hidden" : "block"} max-md:hidden`}>
                    <Tooltip placement="right" value={language.t("sidebar.settings")}>
                      <div>
                        <button
                          type="button"
                          class="w-full flex items-center justify-center p-2 rounded-md hover:bg-surface-base-hover text-text-weak hover:text-text-base transition-colors"
                          onClick={() => props.onSettings?.()}
                        >
                          <Icon name="settings-gear" size="small" />
                          <span class="sr-only">{language.t("sidebar.settings")}</span>
                        </button>
                      </div>
                    </Tooltip>
                    <Tooltip placement="right" value={language.t("sidebar.help")}>
                      <div>
                        <button
                          type="button"
                          class="w-full flex items-center justify-center p-2 rounded-md hover:bg-surface-base-hover text-text-weak hover:text-text-base transition-colors"
                          onClick={() => props.onHelp?.()}
                        >
                          <Icon name="help" size="small" />
                          <span class="sr-only">{language.t("sidebar.help")}</span>
                        </button>
                      </div>
                    </Tooltip>
                  </div>
                  {/* Expanded view - always shown on mobile */}
                  <div class={`${expanded() ? "block" : "hidden"} max-md:block`}>
                      {/* Project header */}
                      <div class="flex items-center justify-between px-2 py-1 min-h-8 hover:bg-surface-base-hover rounded-md mx-2 relative group/project">
                        <button
                          type="button"
                          class="w-full flex items-center gap-2 flex-1 min-w-0 text-left outline-none"
                          onClick={() => setIsProjectExpanded(!isProjectExpanded())}
                        >
                          <ProjectIcon project={project} active={isProjectActive()} />
                          <div class="flex-1 min-w-0 flex flex-col">
                            <span class="text-[13px] font-medium text-text-base truncate">
                              {project.name || getFilename(project.worktree)}
                            </span>
                            <span class="text-[11px] text-text-weak truncate">
                              {props.homedir && project.worktree.startsWith(props.homedir)
                                ? "~" + project.worktree.slice(props.homedir.length)
                                : project.worktree}
                            </span>
                          </div>
                        </button>
                        <div class="flex items-center gap-1 opacity-0 group-hover/project:opacity-100 transition-opacity">
                          <DropdownMenu onOpenChange={(open) => open ? claxedo.rail.lock() : claxedo.rail.unlock()}>
                            <DropdownMenu.Trigger class="p-1 rounded-md text-text-weak hover:text-text-base hover:bg-surface-base-active transition-colors cursor-pointer flex items-center justify-center border-none bg-transparent">
                              <Icon name="kebab" size="small" />
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content class="z-[200]">
                                <DropdownMenu.Item onSelect={() => {
                                  const localProject = {
                                    ...project,
                                    expanded: project.expanded ?? false,
                                  }
                                  dialog.show(() => <DialogEditProject project={localProject} />)
                                }}>
                                  <Icon name="pencil-line" size="small" />
                                  Edit
                                </DropdownMenu.Item>
                                <DropdownMenu.Item onSelect={() => props.onNewSession?.(project.worktree)}>
                                  <Icon name="plus" size="small" />
                                  New Session
                                </DropdownMenu.Item>
                                <Show when={server.isLocal()}>
                                  <DropdownMenu.Separator />
                                  <DropdownMenu.Item onSelect={() => props.onRemoveProject?.(project)}>
                                    <Icon name="close" size="small" />
                                    Remove from list
                                  </DropdownMenu.Item>
                                </Show>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>
                        </div>
                      </div>

                    {/* Sessions list - flat, no workspace grouping */}
                    <Show when={isProjectExpanded()}>
                      {(() => {
                        const projectSessionData = createMemo(() => getProjectSessions(project))
                        const sessions = createMemo(() => projectSessionData().sessions)
                        const hasMore = createMemo(() => projectSessionData().total > sessions().length)

                        return (
                          <div class="pl-4 pr-2 flex flex-col gap-0.5 mt-0.5">
                          <Show when={sessions().length > 0}>
                            <div class="flex flex-col gap-0.5 mb-1">
                              <For each={sessions()}>
                                {(session) => {
                                  const isSessionActive = createMemo(() => props.activeSessionId === session.id)
                                  return (
                                    <div class="rounded-md hover:bg-surface-base-hover group/session relative">
                                      <button
                                        type="button"
                                        class="w-full flex items-center gap-2 py-1 px-2 text-left outline-none"
                                        onClick={() => props.onSessionSelect?.(session.directory ?? project.worktree, session.id)}
                                      >
                                        <span
                                          class={`text-[13px] font-regular truncate flex-1 ${
                                            isSessionActive() ? "text-text-strong" : "text-text-weak"
                                          }`}
                                        >
                                          {session.title}
                                        </span>
                                      </button>
                                      <div class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/session:opacity-100 transition-opacity">
                                        <DropdownMenu onOpenChange={(open) => open ? claxedo.rail.lock() : claxedo.rail.unlock()}>
                                          <DropdownMenu.Trigger class="p-1 rounded-md text-text-weak hover:text-text-base hover:bg-surface-base-active transition-colors cursor-pointer flex items-center justify-center border-none bg-transparent">
                                            <Icon name="kebab" size="small" />
                                          </DropdownMenu.Trigger>
                                          <DropdownMenu.Portal>
                                            <DropdownMenu.Content class="z-[200]">
                                              <DropdownMenu.Item onSelect={() => props.onArchiveSession?.(session)}>
                                                <Icon name="archive" size="small" />
                                                Archive
                                              </DropdownMenu.Item>
                                              <DropdownMenu.Item onSelect={() => props.onDeleteSession?.(session)}>
                                                <Icon name="trash" size="small" />
                                                Delete
                                              </DropdownMenu.Item>
                                            </DropdownMenu.Content>
                                          </DropdownMenu.Portal>
                                        </DropdownMenu>
                                      </div>
                                    </div>
                                  )
                                }}
                              </For>
                            </div>
                          </Show>
                          {/* Load more button */}
                          <Show when={hasMore()}>
                            <div class="relative w-full py-1">
                              <Button
                                variant="ghost"
                                class="flex w-full text-left justify-start text-[13px] text-text-weak px-2"
                                onClick={(e: MouseEvent) => {
                                  loadMoreSessions(project)
                                  ;(e.currentTarget as HTMLButtonElement).blur()
                                }}
                              >
                                {language.t("common.loadMore")}
                              </Button>
                            </div>
                          </Show>
                          </div>
                        )
                      })()}
                    </Show>
                  </div>
                </>
              )
            }}
          </For>

        </div>

        {/* Custom content slot */}
        <Show when={props.children}>
          <div>{props.children}</div>
        </Show>
      </div>

      {/* Footer - fixed at bottom */}
      <div class="shrink-0 mt-auto">
        {/* New Project button */}
        <div class="px-2 py-3">
          {/* Expanded view */}
          <div class={`${expanded() ? "block" : "hidden"} max-md:block`}>
            <Button
              icon="plus-small"
              variant="secondary"
              class="w-full h-8"
              onClick={() => props.onNewProject?.()}
            >
              {language.t("workspace.new")}
            </Button>
          </div>
          {/* Collapsed view */}
          <div class={`${expanded() ? "hidden" : "flex"} justify-center max-md:hidden`}>
            <Tooltip placement="right" value={language.t("workspace.new")}>
              <div>
                <IconButton
                  icon="plus"
                  variant="ghost"
                  size="large"
                  class="rounded"
                  onClick={() => props.onNewProject?.()}
                  aria-label={language.t("workspace.new")}
                />
              </div>
            </Tooltip>
          </div>
        </div>

        {/* Divider */}
        <div class="border-t border-border-weak-base" />

        {/* Footer: Settings, Help */}
        <div class="flex flex-col gap-1 py-2">
          {/* Collapsed footer - hidden on mobile */}
          <div class={`${expanded() ? "hidden" : "flex"} flex-col gap-1 max-md:hidden`}>
            <Tooltip placement="right" value={language.t("sidebar.settings")}>
              <div class="flex items-center justify-center">
                <IconButton
                  icon="settings-gear"
                  variant="ghost"
                  size="large"
                  onClick={() => props.onSettings?.()}
                  aria-label={language.t("sidebar.settings")}
                />
              </div>
            </Tooltip>
            <Tooltip placement="right" value={language.t("sidebar.help")}>
              <div class="flex items-center justify-center">
                <IconButton
                  icon="help"
                  variant="ghost"
                  size="large"
                  onClick={() => props.onHelp?.()}
                  aria-label={language.t("sidebar.help")}
                />
              </div>
            </Tooltip>
            <div class="flex items-center justify-center">
              <StatusPopover
                directory={props.activeWorkspaceId}
                triggerClass="rounded h-10 w-10 border-none shadow-none justify-center px-0 [&>div>span]:hidden data-[expanded]:bg-surface-raised-base-active"
                placement="right-start"
                onOpenChange={(open) => open ? claxedo.rail.lock() : claxedo.rail.unlock()}
              />
            </div>
          </div>
          {/* Expanded footer - always shown on mobile */}
          <div class={`${expanded() ? "flex" : "hidden"} flex-col gap-1 max-md:flex`}>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-left rounded-md mx-2 text-text-weak hover:bg-surface-base-hover hover:text-text-base transition-colors"
              onClick={() => props.onSettings?.()}
            >
              <Icon name="settings-gear" size="normal" />
              <span class="text-sm truncate">{language.t("sidebar.settings")}</span>
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-left rounded-md mx-2 text-text-weak hover:bg-surface-base-hover hover:text-text-base transition-colors"
              onClick={() => props.onHelp?.()}
            >
              <Icon name="help" size="normal" />
              <span class="text-sm truncate">{language.t("sidebar.help")}</span>
            </button>
            <StatusPopover
              directory={props.activeWorkspaceId}
              triggerClass="w-full flex items-center gap-2 px-3 py-2 text-left text-text-weak bg-surface-raised-base hover:bg-surface-raised-base-hover hover:text-text-base transition-colors border-t border-border-weak-base rounded-none"
              placement="right-start"
              onOpenChange={(open) => open ? claxedo.rail.lock() : claxedo.rail.unlock()}
            >
              {(state: { overallHealthy: boolean; serverHealthy: boolean | undefined }) => (
                <>
                  <div class="flex items-center justify-center size-4 shrink-0">
                    <div
                      classList={{
                        "size-2 rounded-full": true,
                        "bg-icon-success-base": state.overallHealthy,
                        "bg-icon-critical-base": !state.overallHealthy && state.serverHealthy !== undefined,
                        "bg-border-weak-base": state.serverHealthy === undefined,
                      }}
                    />
                  </div>
                  <span class="text-sm truncate">{language.t("status.popover.trigger")}</span>
                </>
              )}
            </StatusPopover>
          </div>
        </div>
      </div>
    </nav>
  )
}
