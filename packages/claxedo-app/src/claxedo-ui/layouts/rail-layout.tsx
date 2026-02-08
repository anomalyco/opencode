/**
 * Rail Layout
 *
 * The main layout component implementing the "Rail + Tab" architecture.
 * This wraps/replaces the upstream layout when Claxedo mode is enabled.
 *
 * Structure:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                        Titlebar                              │
 * ├────────┬────────────────────────────────────────────────────┤
 * │        │  [Tab1] [Tab2] [Tab3] [+]  │  [Search]  │  [...]  │
 * │  Rail  ├────────────────────────────────────────────────────┤
 * │        │                                                     │
 * │        │               Tab Content Area                      │
 * │        │                                                     │
 * └────────┴────────────────────────────────────────────────────┘
 */

import { For, Show, createMemo, createSignal, type ParentProps, type JSX, type Accessor } from "solid-js"
import { DragDropProvider, DragDropSensors, DragOverlay, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useClaxedoLayout, ClaxedoLayoutProvider, type TabItem } from "../context/claxedo-layout"
import { RailSidebar, type ProjectItem, type WorkspaceItem } from "./rail-sidebar"
import { TopTabBar, TabDragOverlay, WorkspaceBar, type WorkspaceBarProject } from "./top-tab-bar"
import { GroupContentRenderer } from "../components/group-content-renderer"
import { useCommand, useServer } from "@opencode-ai/claxedo-app"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { getFilename } from "@opencode-ai/util/path"

export type RailLayoutProps = ParentProps<{
  /**
   * List of projects to display in the rail
   */
  projects: ProjectItem[]

  /**
   * Currently active project ID
   */
  activeProjectId?: string

  /**
   * Currently active worktree directory (route)
   */
  activeWorkspaceId?: string

  /**
   * Currently active session ID
   */
  activeSessionId?: string

  /**
   * Home directory for path shortening
   */
  homedir?: string

  /**
   * Callback when a project is selected
   */
  onProjectSelect?: (project: ProjectItem) => void

  /**
   * Callback when a worktree is selected
   */
  onWorkspaceSelect?: (project: ProjectItem, workspaceDir: string) => void

  /**
   * Callback when a session is selected
   */
  onSessionSelect?: (workspaceDir: string, sessionId: string) => void

  /**
   * Callback to create a new project
   */
  onNewProject?: () => void

  /**
   * Callback to create a new worktree in a project
   */
  onNewWorkspace?: (project: ProjectItem) => Promise<import("./top-tab-bar").WorkspaceBarItem | undefined>

  /**
   * Callback to open settings
   */
  onSettings?: () => void

  /**
   * Callback to open help
   */
  onHelp?: () => void

  /**
   * Callback to create a new session (with workspace directory)
   */
  onNewSession?: (workspaceDir: string) => void
  onDeleteSession?: (session: import("./rail-sidebar").SessionItem) => void
  onArchiveSession?: (session: import("./rail-sidebar").SessionItem) => void
  onDeleteWorkspace?: (workspace: import("./rail-sidebar").WorkspaceItem) => void
  onRemoveProject?: (project: import("./rail-sidebar").ProjectItem) => void

  /**
   * Callback to create a new terminal
   * @param command - Optional command to run in the terminal (e.g., "claude --dangerously-skip-permissions")
   * @param title - Optional title for the terminal tab (e.g., "Claude", "Codex")
   */
  onNewTerminal?: (command?: string, title?: string) => void

  /**
   * Callback when a tab is selected
   */
  onTabSelect?: (tab: import("../context/claxedo-layout").TabItem) => void

  /**
   * Render function for empty state (shown when no project selected)
   */
  renderEmpty?: () => JSX.Element

  /**
   * Titlebar component to render
   */
  titlebar?: JSX.Element

  /**
   * Additional content for the top bar (right side)
   */
  topBarRight?: JSX.Element
}>

// Check if running in Tauri desktop environment
const isTauri = () => typeof window !== "undefined" && !!(window as any).__TAURI__

function SplitDragHandle(props: { direction: "h" | "v"; onResize: (delta: number) => void }) {
  let startPos = 0
  let containerSize = 0

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const parent = el.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    startPos = props.direction === "h" ? e.clientX : e.clientY
    containerSize = props.direction === "h" ? rect.width : rect.height

    const move = (ev: PointerEvent) => {
      const current = props.direction === "h" ? ev.clientX : ev.clientY
      const delta = (current - startPos) / containerSize
      startPos = current
      props.onResize(delta)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <div
      class="shrink-0 bg-border-weak-base hover:bg-blue-500/50 transition-colors"
      style={{
        width: props.direction === "h" ? "4px" : "100%",
        height: props.direction === "h" ? "100%" : "4px",
        cursor: props.direction === "h" ? "col-resize" : "row-resize",
      }}
      onPointerDown={handlePointerDown}
    />
  )
}

type GroupPanelProps = {
  groupId: string
  isPrimary: boolean
  props: RailLayoutProps
  workspaceBarProjects: () => WorkspaceBarProject[]
  worktreeInfo: (dir: string) => { name: string; isMain: boolean; tooltip?: string } | undefined
  sidebarPinned: () => boolean
  mobileSidebarOpen: () => boolean
  toggleMobileSidebar: () => void
}

function GroupPanel(gp: GroupPanelProps) {
  const claxedo = useClaxedoLayout()
  const wt = claxedo.groupWorktree(gp.groupId)
  const tabs = createMemo(() => claxedo.groupTabs(gp.groupId))

  return (
    <div class="flex flex-col h-full w-full overflow-hidden">
      {/* Workspace bar - shows projects and their workspaces */}
      <WorkspaceBar
        projects={gp.workspaceBarProjects()}
        defaultDirectory={wt.default()}
        pinnedDirectory={wt.pinned()}
        activeProjectId={gp.props.activeProjectId}
        onWorktreeClick={(projectId, dir) => {
          claxedo.workspaceRecency.recordAccess(projectId, dir)
          if (wt.pinned() && wt.pinned() !== dir) wt.setPinned(null)
          wt.setDefault(dir)
        }}
        onWorktreeDblClick={(projectId, dir) => {
          claxedo.workspaceRecency.recordAccess(projectId, dir)
          wt.setDefault(dir)
          if (wt.pinned() === dir) {
            wt.setPinned(null)
            return
          }
          wt.setPinned(dir)
        }}
        onProjectClick={(projectId) => {
          const proj = gp.props.projects.find((p) => p.id === projectId)
          if (!proj) return
          if (wt.pinned() && wt.pinned() !== proj.worktree) wt.setPinned(null)
          wt.setDefault(proj.worktree)
        }}
        onNewWorktree={async (projectId) => {
          const proj = gp.props.projects.find((p) => p.id === projectId)
          if (!proj) return
          return gp.props.onNewWorkspace?.(proj)
        }}
        onWorktreeDelete={async (projectId, workspace) => {
          if (!gp.props.onDeleteWorkspace) return
          await gp.props.onDeleteWorkspace({
            id: workspace.id,
            directory: workspace.directory,
            name: workspace.name,
            isMain: workspace.isMain,
            projectWorktree: workspace.projectWorktree,
            isCloud: workspace.isCloud,
            canDelete: workspace.canDelete,
          })
        }}
        class="shrink-0"
      />

      {/* Top bar with tabs */}
      <div class="flex items-center shrink-0">
        <TopTabBar
          groupId={gp.groupId}
          onNewSession={() => {
            const dir = wt.default() ?? gp.props.activeWorkspaceId ?? tabs().active()?.directory
            if (!dir) return
            gp.props.onNewSession?.(dir)
          }}
          onNewTerminal={gp.props.onNewTerminal}
          onTabSelect={gp.props.onTabSelect}
          onSettings={gp.props.onSettings}
          onSidebarToggle={() => {
            if (window.innerWidth < 768) {
              gp.toggleMobileSidebar()
            } else {
              claxedo.rail.toggle()
            }
          }}
          sidebarPinned={gp.sidebarPinned()}
          mobileSidebarOpen={gp.mobileSidebarOpen()}
          showSidebarToggle={gp.isPrimary}
          worktreeInfo={gp.worktreeInfo}
          class="flex-1 min-w-0"
        />

        {/* Right side content (search, share, etc.) - only in primary group */}
        <Show when={gp.isPrimary && gp.props.topBarRight}>
          <div class="flex items-center gap-2 px-3 shrink-0 border-b border-border-weak-base h-10 box-content bg-background-base">
            {gp.props.topBarRight}
          </div>
        </Show>
      </div>

      {/* Main content - rendered by GroupContentRenderer based on active tab */}
      <Show
        when={gp.props.activeWorkspaceId}
        fallback={
          <Show when={gp.props.renderEmpty}>
            {(render) => (
              <div class="flex-1 min-h-0 flex flex-col items-center justify-center p-8 text-center text-text-weak">
                {render()()}
              </div>
            )}
          </Show>
        }
      >
        <GroupContentRenderer
          groupId={gp.groupId}
          renderEmpty={() => (
            <div class="flex flex-col items-center justify-center h-full text-text-weak gap-4">
              <span class="text-14-regular">Select a session or create a new one</span>
              <Button icon="plus-small" onClick={() => gp.props.onNewProject?.()}>
                New Project
              </Button>
            </div>
          )}
        />
      </Show>
    </div>
  )
}

/**
 * Shared DragDropProvider for cross-panel tab dragging.
 * Wraps all split groups so sortables/droppables from different panels
 * register with the same provider.
 */
function SharedTabDragDrop(props: { children: JSX.Element }) {
  const claxedo = useClaxedoLayout()
  const [draggedTab, setDraggedTab] = createSignal<TabItem | undefined>()

  const GROUP_ZONE_PREFIX = "group-zone-"

  const handleDragStart = (event: { draggable: { id: unknown } }) => {
    const id = event.draggable?.id
    if (typeof id !== "string") return

    // Find the tab across all groups
    const groupId = claxedo.findTabGroup(id)
    if (!groupId) return
    const tab = claxedo
      .groupTabs(groupId)
      .orderedItems()
      .find((t) => t.id === id)
    setDraggedTab(tab)
  }

  const handleDragEnd = (event: DragEvent) => {
    const { draggable, droppable } = event

    if (draggable && droppable) {
      const dragId = draggable.id.toString()
      const dropId = droppable.id.toString()

      const fromGroupId = claxedo.findTabGroup(dragId)
      // Determine target group: either from a tab ID or from a group zone droppable
      const toGroupId = dropId.startsWith(GROUP_ZONE_PREFIX)
        ? dropId.slice(GROUP_ZONE_PREFIX.length)
        : claxedo.findTabGroup(dropId)

      // Cross-group transfer: move tab on drop
      if (fromGroupId && toGroupId && fromGroupId !== toGroupId) {
        claxedo.split.moveTab(dragId, fromGroupId, toGroupId)
      }
    }

    setDraggedTab(undefined)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const dragId = draggable.id.toString()
    const dropId = droppable.id.toString()

    // Skip group zone droppables for reorder — they only matter on drop
    if (dropId.startsWith(GROUP_ZONE_PREFIX)) return

    const fromGroupId = claxedo.findTabGroup(dragId)
    const toGroupId = claxedo.findTabGroup(dropId)

    // Same group → reorder live
    if (fromGroupId && toGroupId && fromGroupId === toGroupId) {
      const tabs = claxedo.groupTabs(fromGroupId)
      const ids = tabs.order().length ? tabs.order() : tabs.orderedItems().map((t) => t.id)
      const fromIndex = ids.indexOf(dragId)
      const toIndex = ids.indexOf(dropId)
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        tabs.move(dragId, toIndex)
      }
    }
    // Different groups → no-op (transfer happens in handleDragEnd)
  }

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      collisionDetector={closestCenter}
    >
      <DragDropSensors />
      {props.children}
      <DragOverlay>
        <TabDragOverlay tab={draggedTab()} />
      </DragOverlay>
    </DragDropProvider>
  )
}

function RailLayoutInner(props: RailLayoutProps) {
  const claxedo = useClaxedoLayout()
  const command = useCommand()
  const server = useServer()

  const sidebarPinned = () => claxedo.rail.pinned()

  // Mobile sidebar state - separate from desktop pinned state
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false)

  const toggleMobileSidebar = () => setMobileSidebarOpen(!mobileSidebarOpen())
  const closeMobileSidebar = () => setMobileSidebarOpen(false)

  // Register keyboard shortcuts
  command.register(() => [
    {
      id: "claxedo.tab.close",
      title: "Close Tab",
      category: "View",
      keybind: "mod+w",
      onSelect: () => {
        const focusedId = claxedo.split.focusedId()
        claxedo.groupTabs(focusedId!).closeActive()
      },
    },
    {
      id: "claxedo.tab.next",
      title: "Next Tab",
      category: "View",
      keybind: "mod+tab",
      onSelect: () => {
        const focusedId = claxedo.split.focusedId()
        claxedo.groupTabs(focusedId!).activateNext()
      },
    },
    {
      id: "claxedo.tab.previous",
      title: "Previous Tab",
      category: "View",
      keybind: "mod+shift+tab",
      onSelect: () => {
        const focusedId = claxedo.split.focusedId()
        claxedo.groupTabs(focusedId!).activatePrevious()
      },
    },
    {
      id: "claxedo.tab.reopen",
      title: "Reopen Closed Tab",
      category: "View",
      keybind: "mod+shift+t",
      onSelect: () => {
        const focusedId = claxedo.split.focusedId()
        claxedo.groupTabs(focusedId!).reopenLast()
      },
    },
    {
      id: "claxedo.sidebar.toggle",
      title: "Toggle Sidebar",
      category: "View",
      keybind: "mod+b",
      onSelect: () => claxedo.rail.toggle(),
    },
    // Tab switching shortcuts (Cmd+1 through Cmd+9)
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `claxedo.tab.${i + 1}`,
      title: `Switch to Tab ${i + 1}`,
      category: "View",
      keybind: `mod+${i + 1}`,
      onSelect: () => {
        const focusedId = claxedo.split.focusedId()
        claxedo.groupTabs(focusedId!).activateByIndex(i)
      },
    })),
    // Split view shortcuts
    {
      id: "claxedo.split.toggle",
      title: "Toggle Split View",
      category: "View",
      keybind: "mod+\\",
      onSelect: () => claxedo.split.toggle(),
    },
    {
      id: "claxedo.split.focusLeft",
      title: "Focus Left/Top Panel",
      category: "View",
      keybind: "mod+alt+ArrowLeft",
      onSelect: () => {
        const groups = claxedo.split.groups()
        const focusedId = claxedo.split.focusedId()
        const idx = groups.findIndex((g) => g.id === focusedId)
        if (idx > 0) claxedo.split.setFocus(groups[idx - 1].id)
      },
    },
    {
      id: "claxedo.split.focusRight",
      title: "Focus Right/Bottom Panel",
      category: "View",
      keybind: "mod+alt+ArrowRight",
      onSelect: () => {
        const groups = claxedo.split.groups()
        const focusedId = claxedo.split.focusedId()
        const idx = groups.findIndex((g) => g.id === focusedId)
        if (idx < groups.length - 1) claxedo.split.setFocus(groups[idx + 1].id)
      },
    },
  ])

  // Helper: Get workspaces for a project (main worktree + sandboxes)
  const getProjectWorkspaces = (project: ProjectItem): WorkspaceItem[] => {
    const workspaces: WorkspaceItem[] = []
    const isCloud = !server.isLocal()

    // Main workspace
    // Can only delete main workspace if it's a cloud sandbox
    workspaces.push({
      id: project.worktree,
      directory: project.worktree,
      name: "main",
      isMain: true,
      projectWorktree: project.worktree,
      isCloud,
      canDelete: isCloud,
    })

    // Additional sandboxes
    if (project.sandboxes) {
      for (const sandbox of project.sandboxes) {
        if (sandbox === project.worktree) continue
        workspaces.push({
          id: sandbox,
          directory: sandbox,
          name: getFilename(sandbox),
          projectWorktree: project.worktree,
          isCloud,
          canDelete: true,
        })
      }
    }

    return workspaces
  }

  // Find current project (the one containing activeWorkspaceId)
  const currentProject = createMemo(() => {
    const activeWs = props.activeWorkspaceId
    if (!activeWs) return undefined
    return props.projects.find((p) => p.worktree === activeWs || p.sandboxes?.includes(activeWs))
  })

  // Build workspace bar projects data
  const workspaceBarProjects = createMemo((): WorkspaceBarProject[] => {
    return props.projects.map((project) => {
      const allWorkspaces = getProjectWorkspaces(project)
      const recency = claxedo.workspaceRecency.getRecent(project.id, 5)

      // Determine which workspaces to show:
      // - If <=5 workspaces, show all
      // - Otherwise show last 5 accessed (from recency) + any with notifications
      let displayWorkspaces = allWorkspaces
      if (allWorkspaces.length > 5) {
        const recencySet = new Set(recency)
        // Filter to recency list, keeping order
        displayWorkspaces = recency
          .map((dir) => allWorkspaces.find((ws) => ws.directory === dir))
          .filter((ws): ws is WorkspaceItem => !!ws)

        // Add any with notifications that aren't already shown
        // (notification logic will be added when we have real notification data)

        // Ensure we have at least the main workspace
        const hasMain = displayWorkspaces.some((ws) => ws.isMain)
        if (!hasMain) {
          const main = allWorkspaces.find((ws) => ws.isMain)
          if (main) displayWorkspaces.unshift(main)
        }

        // Limit to 5
        displayWorkspaces = displayWorkspaces.slice(0, 5)
      }

      return {
        id: project.id,
        name: project.name || getFilename(project.worktree),
        worktree: project.worktree,
        workspaces: displayWorkspaces.map((ws) => ({
          id: ws.id,
          directory: ws.directory,
          name: ws.name || getFilename(ws.directory),
          notification: false, // TODO: wire up real notification state
        })),
      }
    })
  })

  const worktreeInfo = (dir: string) => {
    const proj = props.projects.find((p) => p.worktree === dir || p.sandboxes?.includes(dir))
    if (!proj) return
    const isMain = dir === proj.worktree
    const name = isMain ? "main" : getFilename(dir)
    return { name, isMain, tooltip: `🌳 ${name}` }
  }

  return (
    <div class="flex flex-col w-full h-full bg-background-base overflow-hidden" data-claxedo>
      {/* Desktop window chrome spacer - for macOS traffic lights / Windows title bar */}
      <Show when={!props.titlebar && isTauri()}>
        <div class="h-10 shrink-0 bg-background-base" data-tauri-drag-region />
      </Show>

      {/* Titlebar */}
      <Show when={props.titlebar}>
        <div class="shrink-0">{props.titlebar}</div>
      </Show>

      <div class="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Mobile backdrop - closes sidebar when tapped */}
        <Show when={mobileSidebarOpen()}>
          <div class="fixed inset-0 bg-black/50 z-[90] md:hidden" onClick={closeMobileSidebar} />
        </Show>

        {/* Sidebar container - desktop: floats/pinned, mobile: slide-in overlay */}
        <div
          class={`
            flex flex-col
            transition-all duration-200 ease-out
            ${
              sidebarPinned()
                ? "relative z-10 shrink-0 h-full"
                : "absolute top-7 left-0 bottom-0 z-[100] pointer-events-none"
            }
            max-md:fixed max-md:top-0 max-md:left-0 max-md:bottom-0 max-md:z-[100] max-md:pointer-events-auto
            max-md:transition-transform max-md:duration-300 max-md:ease-in-out
            ${mobileSidebarOpen() ? "max-md:translate-x-0" : "max-md:-translate-x-full"}
          `}
        >
          {/* Spacer to align with workspace bar - only when pinned */}
          <Show when={sidebarPinned()}>
            <div class="h-8 shrink-0 bg-background-base" />
          </Show>

          {/* Rail Sidebar wrapper - flex-1 to fill remaining space */}
          <div class="flex-1 min-h-0">
            <RailSidebar
              projects={props.projects}
              activeProjectId={props.activeProjectId}
              activeWorkspaceId={props.activeWorkspaceId}
              activeSessionId={props.activeSessionId}
              homedir={props.homedir}
              onProjectSelect={(project) => {
                props.onProjectSelect?.(project)
                closeMobileSidebar()
              }}
              onWorkspaceSelect={(project, workspaceDir) => {
                props.onWorkspaceSelect?.(project, workspaceDir)
                closeMobileSidebar()
              }}
              onSessionSelect={(workspaceDir, sessionId) => {
                props.onSessionSelect?.(workspaceDir, sessionId)
                closeMobileSidebar()
              }}
              onNewSession={(workspaceDir) => {
                props.onNewSession?.(workspaceDir)
                closeMobileSidebar()
              }}
              onDeleteSession={props.onDeleteSession}
              onArchiveSession={props.onArchiveSession}
              onDeleteWorkspace={props.onDeleteWorkspace}
              onRemoveProject={props.onRemoveProject}
              onNewWorkspace={(project) => {
                props.onNewWorkspace?.(project)
                closeMobileSidebar()
              }}
              onNewProject={() => {
                props.onNewProject?.()
                closeMobileSidebar()
              }}
              onSettings={() => {
                props.onSettings?.()
                closeMobileSidebar()
              }}
              onHelp={() => {
                props.onHelp?.()
                closeMobileSidebar()
              }}
            />
          </div>
        </div>

        {/* Main content area */}
        <div
          class={`flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-background-stronger transition-all duration-200 ease-out max-md:!border-l-0 ${
            sidebarPinned() ? "border-l border-border-weak-base" : ""
          }`}
          style={{ "padding-left": sidebarPinned() ? undefined : "12px" }}
        >
          <SharedTabDragDrop>
            {(() => {
              // When split is hidden, only show the primary (first) group
              const visibleGroups = createMemo(() => {
                const groups = claxedo.split.groups()
                if (claxedo.split.hidden()) {
                  const focused = groups.find((g) => g.id === claxedo.split.focusedId())
                  return [focused ?? groups[0]].filter(Boolean)
                }
                return groups
              })

              return (
                <div
                  class="flex flex-1 min-h-0 overflow-hidden"
                  style={{ "flex-direction": claxedo.split.direction() === "h" ? "row" : "column" }}
                >
                  <For each={visibleGroups()}>
                    {(group, i) => (
                      <>
                        <Show when={i() > 0}>
                          <SplitDragHandle
                            direction={claxedo.split.direction()}
                            onResize={(delta) => {
                              const sizes = [...claxedo.split.sizes()]
                              const idx = i()
                              const total = sizes[idx - 1] + sizes[idx]
                              sizes[idx - 1] = Math.max(0.1, Math.min(total - 0.1, sizes[idx - 1] + delta))
                              sizes[idx] = total - sizes[idx - 1]
                              claxedo.split.setSizes(sizes)
                            }}
                          />
                        </Show>
                        <div
                          style={{
                            flex: claxedo.split.hidden() ? "1 1 100%" : `0 0 ${claxedo.split.sizes()[i()] * 100}%`,
                          }}
                          class="min-w-0 min-h-0 overflow-hidden relative"
                          classList={{
                            "ring-1 ring-inset ring-blue-500/30":
                              claxedo.split.active() && group.id === claxedo.split.focusedId(),
                          }}
                          onPointerDown={() => claxedo.split.setFocus(group.id)}
                        >
                          {/* Close button for non-primary panels */}
                          <Show when={i() > 0}>
                            <div class="absolute top-0 right-0 z-10">
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                onClick={(e: MouseEvent) => {
                                  e.stopPropagation()
                                  claxedo.split.closeGroup(group.id)
                                }}
                                aria-label="Close panel"
                                class="opacity-60 hover:opacity-100"
                              />
                            </div>
                          </Show>
                          <GroupPanel
                            groupId={group.id}
                            isPrimary={i() === 0}
                            props={props}
                            workspaceBarProjects={workspaceBarProjects}
                            worktreeInfo={worktreeInfo}
                            sidebarPinned={sidebarPinned}
                            mobileSidebarOpen={mobileSidebarOpen}
                            toggleMobileSidebar={toggleMobileSidebar}
                          />
                        </div>
                      </>
                    )}
                  </For>
                </div>
              )
            })()}
          </SharedTabDragDrop>

          {/* Mount route content (DirectoryLayout + providers) without rendering it visually.
              Session content is rendered by GroupContentRenderer via DirectoryScope (session.tsx
              bails out early here). This hidden mount is kept for ClaxedoDirectoryProvider
              which needs the route's TerminalProvider for terminal tab management. */}
          <div class="hidden">{props.children}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * Rail Layout Inner (without provider)
 *
 * Use this when you need to provide your own ClaxedoLayoutProvider.
 */
export { RailLayoutInner }

/**
 * Rail Layout with provider
 *
 * Use this component at the top level to enable Claxedo layout mode.
 */
export function RailLayout(props: RailLayoutProps) {
  return (
    <ClaxedoLayoutProvider>
      <RailLayoutInner {...props} />
    </ClaxedoLayoutProvider>
  )
}

/**
 * Hook to check if Claxedo layout is enabled
 */
export function useClaxedoEnabled() {
  try {
    const claxedo = useClaxedoLayout()
    return createMemo(() => claxedo.enabled())
  } catch {
    // Context not available, Claxedo not enabled
    return () => false
  }
}
