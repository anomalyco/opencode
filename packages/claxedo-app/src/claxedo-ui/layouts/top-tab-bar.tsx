/**
 * Top Tab Bar Component
 *
 * Horizontal tab bar for sessions, terminals, and file tabs.
 * Features:
 * - Drag-to-reorder tabs
 * - Close buttons on hover
 * - Badge display for changes
 * - Keyboard navigation
 */

import { For, Show, createMemo, createSignal, createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { SortableProvider, createSortable, createDroppable } from "@thisbeyond/solid-dnd"
import { useClaxedoLayout, type TabItem, type TabType } from "../context/claxedo-layout"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Popover } from "@opencode-ai/ui/popover"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@opencode-ai/claxedo-app"
import { useTheme } from "@opencode-ai/ui/theme"
import { getFilename } from "@opencode-ai/util/path"
import { getTerminalCommands } from "../../components/settings-terminals"
// Loading indicator - pulsing dot
const PULSE_INTERVAL = 500

/** Pulsing dot component for loading state */
function LoadingIndicator(props: { class?: string }) {
  const [visible, setVisible] = createSignal(true)

  const interval = setInterval(() => {
    setVisible((prev) => !prev)
  }, PULSE_INTERVAL)

  onCleanup(() => clearInterval(interval))

  return (
    <span
      class={`relative flex shrink-0 ${props.class ?? ""}`}
      style={{ width: "10px", height: "10px" }}
      aria-hidden="true"
    >
      <span
        class="absolute inline-flex rounded-full"
        style={{
          width: "10px",
          height: "10px",
          "background-color": "#f59e0b", // amber-500
          opacity: visible() ? 1 : 0.4,
          transition: "opacity 200ms ease-in-out",
        }}
      />
    </span>
  )
}

/** Attention dot indicator (red pulsing dot) */
function AttentionDot(props: { class?: string }) {
  return (
    <span class={`relative flex shrink-0 ${props.class ?? ""}`} style={{ width: "10px", height: "10px" }}>
      <span
        class="absolute inline-flex animate-ping rounded-full"
        style={{
          width: "10px",
          height: "10px",
          "background-color": "#f87171", // red-400
          opacity: 0.75,
        }}
      />
      <span
        class="relative inline-flex rounded-full"
        style={{
          width: "10px",
          height: "10px",
          "background-color": "#ef4444", // red-500
        }}
      />
    </span>
  )
}

/** Done indicator (green dot) */
function DoneDot(props: { class?: string }) {
  return (
    <span class={`relative flex shrink-0 ${props.class ?? ""}`} style={{ width: "10px", height: "10px" }}>
      <span
        class="relative inline-flex rounded-full"
        style={{
          width: "10px",
          height: "10px",
          "background-color": "#22c55e", // green-500
        }}
      />
    </span>
  )
}

// Get terminal commands (reads from localStorage with defaults)
const getCommands = () => {
  const stored = getTerminalCommands()
  return {
    claude: stored.claude,
    codex: stored.codex,
    terminal: "",
    custom: stored.custom,
  }
}

// Icon mapping for tab types
export const TAB_ICONS: Record<TabType, "bubble-5" | "console" | "code" | "folder"> = {
  session: "bubble-5",
  terminal: "console",
  review: "code",
  file: "folder",
}

export type TopTabBarProps = {
  groupId?: string
  onNewSession?: () => void
  onNewTerminal?: (command?: string, title?: string) => void
  onTabSelect?: (tab: TabItem) => void
  onSidebarToggle?: () => void
  onSettings?: () => void
  sidebarPinned?: boolean
  mobileSidebarOpen?: boolean
  showSidebarToggle?: boolean
  worktreeInfo?: (directory: string) => { name: string; isMain: boolean; tooltip?: string } | undefined
  class?: string
}

function SortableTab(props: {
  tab: TabItem
  isActive: boolean
  onClose: (tabId: string) => void
  onSelect?: (tab: TabItem) => void
  onSetActive: (tabId: string) => void
  onDblClick: (dir: string) => void
  onContextMenu?: (e: MouseEvent, tabId: string) => void
  worktreeName?: string
  worktreeColor?: string
}) {
  const sortable = createSortable(props.tab.id)

  const handleSelect = () => {
    props.onSetActive(props.tab.id)
    props.onSelect?.(props.tab)
  }

  const handleDblClick = () => {
    props.onDblClick(props.tab.directory)
  }

  const handleAuxClick = (e: MouseEvent) => {
    if (e.button !== 1 || !props.tab.closable) return
    e.preventDefault()
    const tabId = props.tab.id
    queueMicrotask(() => props.onClose(tabId))
  }

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation()
    const tabId = props.tab.id
    queueMicrotask(() => props.onClose(tabId))
  }

  const handleContextMenu = (e: MouseEvent) => {
    props.onContextMenu?.(e, props.tab.id)
  }

  return (
    <div
      // @ts-ignore - solid-dnd directive
      use:sortable
      class="group flex items-center h-10 pl-2 pr-0 cursor-pointer flex-shrink-0 max-w-[200px] min-w-[100px] select-none bg-transparent max-md:min-w-[60px] max-md:max-w-[150px] max-md:pl-1.5"
      classList={{ "opacity-50": sortable.isActiveDraggable }}
      onClick={handleSelect}
      onDblClick={handleDblClick}
      onAuxClick={handleAuxClick}
      onContextMenu={handleContextMenu}
    >
      <div class="flex items-center gap-1 min-w-0 flex-1 group/title">
        <span
          class={`text-[13px] max-md:text-[12px] font-[450] whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0 transition-colors duration-100 ${
            props.isActive ? "text-text-strong font-medium" : "text-text-weak group-hover:text-text-base"
          }`}
        >
          {props.tab.title}
        </span>

        {/* Worktree indicator - shows on last tab of each group */}
        <Show when={props.worktreeName}>
          {(name) => (
            <Tooltip value={`Worktree: ${name()}`}>
              <span
                class="w-4 flex items-center justify-center opacity-0 group-hover/title:opacity-100 shrink-0"
                style={{ color: props.worktreeColor }}
              >
                <Icon name="branch" size="small" />
              </span>
            </Tooltip>
          )}
        </Show>
      </div>

      {/* Loading spinner - shows when session/terminal is working */}
      <Show when={props.tab.loading}>
        <LoadingIndicator class="mx-1" />
      </Show>

      {/* Attention dot - shows when terminal needs attention (e.g., interrupted) */}
      <Show when={props.tab.attention && !props.tab.loading}>
        <AttentionDot class="flex-shrink-0 mx-1" />
      </Show>

      {/* Done dot - shows after an agent completes at least one turn, only on inactive tabs */}
      <Show when={props.tab.done && !props.tab.loading && !props.tab.attention && !props.isActive}>
        <DoneDot class="flex-shrink-0 mx-1" />
      </Show>

      {/* Close button - full height, no margin */}
      <Show when={props.tab.closable}>
        <button
          type="button"
          class={`flex items-center justify-center w-8 h-10 p-0 bg-transparent border-none cursor-pointer flex-shrink-0 transition-all duration-100 ${
            props.isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } text-icon-weak hover:bg-surface-base-hover hover:text-icon-base`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          aria-label="Close tab"
        >
          <Icon name="close" size="small" />
        </button>
      </Show>
    </div>
  )
}

export function TabDragOverlay(props: { tab: TabItem | undefined }) {
  return (
    <Show when={props.tab}>
      {(tab) => (
        <div class="flex items-center h-10 px-2 cursor-pointer flex-shrink-0 max-w-[200px] min-w-[100px] select-none bg-surface-raised-base shadow-[0_4px_8px_rgba(0,0,0,0.2)]">
          <Icon name={TAB_ICONS[tab().type]} size="small" class="hidden" />
          <span class="text-[13px] font-[450] text-text-weak whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">
            {tab().title}
          </span>
        </div>
      )}
    </Show>
  )
}

export function TopTabBar(props: TopTabBarProps) {
  const claxedo = useClaxedoLayout()
  const language = useLanguage()
  const theme = useTheme()

  // Muted worktree border colors for dark mode — desaturated to avoid glare
  const DARK_WORKTREE_COLORS: Record<string, string> = {
    "#3b82f6": "#6e93b8", // blue → dusty blue
    "#22c55e": "#6da88a", // green → sage
    "#a855f7": "#9a82b5", // purple → lavender
    "#f97316": "#c09060", // orange → warm tan
    "#ec4899": "#b57e95", // pink → dusty rose
  }

  const wtBorderColor = (color: string | undefined) => {
    if (!color || color === "transparent") return "transparent"
    if (theme.mode() === "dark") return DARK_WORKTREE_COLORS[color] ?? color
    return color
  }

  // Use group-specific tabs when groupId is provided, otherwise backward-compatible topTabs
  const tabs = createMemo(() => (props.groupId ? claxedo.groupTabs(props.groupId) : claxedo.topTabs))
  const wt = createMemo(() => (props.groupId ? claxedo.groupWorktree(props.groupId) : claxedo.worktree))

  const [contextMenu, setContextMenu] = createSignal<{ tabId: string; x: number; y: number } | null>(null)
  const active = createMemo(() => tabs().active())
  const pinned = createMemo(() => wt().pinned())

  const orderedTabs = createMemo(() => tabs().orderedItems())
  const visibleTabs = createMemo(() => {
    const dir = pinned()
    if (!dir) return orderedTabs()
    return orderedTabs().filter((t) => t.directory === dir)
  })

  // When filtering, auto-select first visible tab if active tab is filtered out
  createEffect(() => {
    const visible = visibleTabs()
    const currentActive = active()
    if (!currentActive) return
    const isActiveVisible = visible.some((t) => t.id === currentActive.id)
    if (!isActiveVisible && visible.length > 0) {
      tabs().setActive(visible[0].id)
    }
  })

  const tabIds = createMemo(() => visibleTabs().map((t) => t.id))

  // Group tabs by worktree for visual grouping
  const tabGroups = createMemo(() => {
    const groups = new Map<string, TabItem[]>()
    for (const tab of visibleTabs()) {
      const existing = groups.get(tab.directory) || []
      existing.push(tab)
      groups.set(tab.directory, existing)
    }
    return Array.from(groups.entries())
  })

  // Get color for active worktree (for action buttons)
  const activeWorktreeColor = createMemo(() => {
    if (!props.groupId) return undefined
    return claxedo.getActiveWorktreeColor(props.groupId)
  })

  // Droppable zone for cross-panel drops (dropping onto the tab bar area)
  const droppable = createDroppable(`group-zone-${props.groupId ?? "default"}`)

  const handleTabClose = (tabId: string) => {
    tabs().close(tabId)
  }

  const handleTabSetActive = (tabId: string) => {
    tabs().setActive(tabId)
  }

  const handleTabDblClick = (dir: string) => {
    wt().setDefault(dir)
    if (wt().pinned() === dir) {
      wt().setPinned(null)
      return
    }
    wt().setPinned(dir)
  }

  const handleTabContextMenu = (e: MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }

  // Close context menu on click anywhere
  const closeContextMenu = () => setContextMenu(null)

  return (
    <div
      class={`flex items-center h-10 bg-background-base px-2 gap-0 overflow-hidden border-b border-border-weak-base box-content ${props.class ?? ""}`}
    >
      {/* Sidebar toggle button - hamburger on mobile, layout icon on desktop. Only on primary panel. */}
      <Show when={props.showSidebarToggle !== false}>
        <Tooltip value={props.sidebarPinned ? "Hide Sidebar" : "Show Sidebar"}>
          <div class="flex items-center">
            {/* Mobile: hamburger/close icon */}
            <IconButton
              icon={props.mobileSidebarOpen ? "close" : "menu"}
              variant="ghost"
              class="shrink-0 mr-2 rounded md:hidden"
              onClick={() => props.onSidebarToggle?.()}
              aria-label={props.mobileSidebarOpen ? "Close Menu" : "Open Menu"}
            />
          </div>
        </Tooltip>
      </Show>

      {/* Droppable zone wraps the tab bar area for cross-panel drops */}
      <div
        // @ts-ignore - solid-dnd directive
        use:droppable
        class="flex items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden flex-1 no-scrollbar"
      >
        <SortableProvider ids={tabIds()}>
          <For each={tabGroups()}>
            {([directory, groupTabs], groupIndex) => {
              const color = claxedo.getWorktreeColor(directory)
              const isLastGroup = groupIndex() === tabGroups().length - 1

              return (
                <div class="flex items-center border-b" style={{ "border-color": wtBorderColor(color) }}>
                  <For each={groupTabs}>
                    {(tab, tabIndex) => (
                      <>
                        <Show when={tabIndex() > 0 || groupIndex() > 0}>
                          <div class="w-px h-10 bg-border-weak-base flex-shrink-0" />
                        </Show>
                        <SortableTab
                          tab={tab}
                          isActive={tabs().activeId() === tab.id}
                          onClose={handleTabClose}
                          onSelect={props.onTabSelect}
                          onSetActive={handleTabSetActive}
                          onDblClick={handleTabDblClick}
                          onContextMenu={handleTabContextMenu}
                          worktreeName={
                            tabIndex() === groupTabs.length - 1 ? claxedo.getWorktreeName(directory) : undefined
                          }
                          worktreeColor={color}
                        />
                      </>
                    )}
                  </For>
                </div>
              )
            }}
          </For>
        </SortableProvider>

        {/* Action buttons - immediately after tabs */}
        <Show when={wt().default() || active()?.directory}>
          <div
            class="flex items-center gap-0 flex-shrink-0 border-b"
            style={{ "border-color": wtBorderColor(activeWorktreeColor()) }}
          >
            <Tooltip value={language.t("command.session.new")}>
              <button
                type="button"
                class="flex items-center justify-center w-8 h-10 hover:bg-surface-base-hover text-text-weak hover:text-text-base transition-colors shrink-0"
                onClick={() => props.onNewSession?.()}
                aria-label={language.t("command.session.new")}
              >
                <Icon name="plus-small" size="small" />
              </button>
            </Tooltip>

            {/* Claude button */}
            <Tooltip value="New Claude Terminal">
              <button
                type="button"
                class="flex items-center justify-center w-8 h-10 hover:bg-surface-base-hover text-text-weak hover:text-text-base transition-colors shrink-0"
                onClick={() => props.onNewTerminal?.(getCommands().claude, "Claude")}
                aria-label="New Claude Terminal"
              >
                <span class="text-xs font-bold">C</span>
              </button>
            </Tooltip>

            {/* Codex button */}
            <Tooltip value="New Codex Terminal">
              <button
                type="button"
                class="flex items-center justify-center w-8 h-10 hover:bg-surface-base-hover text-text-weak hover:text-text-base transition-colors shrink-0"
                onClick={() => props.onNewTerminal?.(getCommands().codex, "Codex")}
                aria-label="New Codex Terminal"
              >
                <span class="text-xs font-bold">X</span>
              </button>
            </Tooltip>

            {/* Terminal button */}
            <Tooltip value="New Terminal">
              <button
                type="button"
                class="flex items-center justify-center w-8 h-10 hover:bg-surface-base-hover text-text-weak hover:text-text-base transition-colors shrink-0"
                onClick={() => props.onNewTerminal?.()}
                aria-label="New Terminal"
              >
                <Icon name="console" size="small" />
              </button>
            </Tooltip>

            {/* More dropdown */}
            <DropdownMenu>
              <DropdownMenu.Trigger class="flex items-center justify-center w-8 h-10 hover:bg-surface-base-hover text-text-weak hover:text-text-base transition-colors cursor-pointer border-none bg-transparent shrink-0">
                <Icon name="chevron-down" size="small" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="z-[200]">
                  <DropdownMenu.Item onSelect={() => props.onNewTerminal?.(getCommands().claude, "Claude")}>
                    <span class="font-bold mr-2">C</span>
                    Claude
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => props.onNewTerminal?.(getCommands().codex, "Codex")}>
                    <span class="font-bold mr-2">X</span>
                    Codex
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => props.onNewTerminal?.()}>
                    <Icon name="console" size="small" class="mr-2" />
                    Terminal
                  </DropdownMenu.Item>
                  {/* Custom commands from settings */}
                  <Show when={getCommands().custom.length > 0}>
                    <DropdownMenu.Separator />
                    <For each={getCommands().custom}>
                      {(cmd) => (
                        <Show when={cmd.name && cmd.command}>
                          <DropdownMenu.Item onSelect={() => props.onNewTerminal?.(cmd.command, cmd.name)}>
                            <Icon name="console" size="small" class="mr-2" />
                            {cmd.name}
                          </DropdownMenu.Item>
                        </Show>
                      )}
                    </For>
                  </Show>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={() => props.onSettings?.()}>
                    <Icon name="settings-gear" size="small" class="mr-2" />
                    Configure...
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
        </Show>
      </div>

      {/* Tab context menu - portaled to body to escape overflow clipping */}
      <Show when={contextMenu()}>
        {(menu) => {
          const groupId = () => props.groupId
          const isSplit = () => claxedo.split.active()
          const groups = () => claxedo.split.groups()
          const otherGroupId = () => {
            const all = groups()
            const gId = groupId()
            return all.find((g) => g.id !== gId)?.id
          }
          return (
            <Portal>
              <div
                class="fixed inset-0 z-[300]"
                onClick={closeContextMenu}
                onContextMenu={(e) => {
                  e.preventDefault()
                  closeContextMenu()
                }}
              />
              <div
                class="fixed z-[301] bg-background-base border border-border-weak-base rounded-md shadow-lg py-1 min-w-[180px]"
                style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
              >
                <Show when={!isSplit()}>
                  <button
                    type="button"
                    class="w-full px-3 py-1.5 text-left text-[13px] text-text-base hover:bg-surface-base-hover transition-colors"
                    onClick={() => {
                      const gId = groupId()
                      if (gId) claxedo.split.moveTab(menu().tabId, gId, "new")
                      closeContextMenu()
                    }}
                  >
                    Open in Split View
                  </button>
                </Show>
                <Show when={isSplit() && otherGroupId()}>
                  <button
                    type="button"
                    class="w-full px-3 py-1.5 text-left text-[13px] text-text-base hover:bg-surface-base-hover transition-colors"
                    onClick={() => {
                      const gId = groupId()
                      const other = otherGroupId()
                      if (gId && other) claxedo.split.moveTab(menu().tabId, gId, other)
                      closeContextMenu()
                    }}
                  >
                    Move to Other Panel
                  </button>
                </Show>
                <button
                  type="button"
                  class="w-full px-3 py-1.5 text-left text-[13px] text-text-base hover:bg-surface-base-hover transition-colors"
                  onClick={() => {
                    tabs().close(menu().tabId)
                    closeContextMenu()
                  }}
                >
                  Close Tab
                </button>
              </div>
            </Portal>
          )
        }}
      </Show>
    </div>
  )
}

/**
 * Individual tab component for use outside the tab bar
 * (e.g., for rendering a single tab in a different context)
 */
export function TopTab(props: { tab: TabItem; active?: boolean; onSelect?: () => void; onClose?: () => void }) {
  const handleClick = (e: MouseEvent) => {
    if (e.button === 1 && props.tab.closable) {
      e.preventDefault()
      props.onClose?.()
      return
    }
    props.onSelect?.()
  }

  return (
    <div
      class="group flex items-center h-10 pl-2 pr-0 cursor-pointer flex-shrink-0 max-w-[200px] min-w-[100px] select-none bg-transparent max-md:min-w-[60px] max-md:max-w-[150px] max-md:pl-1.5"
      onMouseDown={handleClick}
      onAuxClick={handleClick}
    >
      <span
        class={`text-[13px] max-md:text-[12px] font-[450] whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0 transition-colors duration-100 ${
          props.active ? "text-text-strong font-medium" : "text-text-weak group-hover:text-text-base"
        }`}
      >
        {props.tab.title}
      </span>

      {/* Loading spinner - shows when session/terminal is working */}
      <Show when={props.tab.loading}>
        <LoadingIndicator class="mx-1" />
      </Show>

      {/* Attention dot - shows when terminal needs attention (e.g., interrupted) */}
      <Show when={props.tab.attention && !props.tab.loading}>
        <AttentionDot class="flex-shrink-0 mx-1" />
      </Show>

      {/* Done dot - shows after an agent completes at least one turn, only on inactive tabs */}
      <Show when={props.tab.done && !props.tab.loading && !props.tab.attention && !props.active}>
        <DoneDot class="flex-shrink-0 mx-1" />
      </Show>

      <Show when={props.tab.closable}>
        <button
          type="button"
          class={`flex items-center justify-center w-8 h-10 p-0 bg-transparent border-none cursor-pointer flex-shrink-0 transition-all duration-100 ${
            props.active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          } text-icon-weak hover:bg-surface-base-hover hover:text-icon-base`}
          onClick={(e) => {
            e.stopPropagation()
            props.onClose?.()
          }}
          aria-label="Close tab"
        >
          <Icon name="close" size="small" />
        </button>
      </Show>
    </div>
  )
}

export type WorkspaceBarItem = {
  id: string
  directory: string
  name: string
  notification?: boolean
  isMain?: boolean
  isCloud?: boolean
  canDelete?: boolean
  projectWorktree?: string
}

export type WorkspaceBarProject = {
  id: string
  name: string
  worktree: string
  workspaces: WorkspaceBarItem[]
}

export type WorkspaceBarProps = {
  projects: WorkspaceBarProject[]
  defaultDirectory?: string | null
  pinnedDirectory?: string | null
  activeProjectId?: string
  onWorktreeClick?: (projectId: string, directory: string) => void
  onWorktreeDblClick?: (projectId: string, directory: string) => void
  onWorktreeDelete?: (projectId: string, workspace: WorkspaceBarItem) => Promise<void> | void
  onProjectClick?: (projectId: string) => void
  onNewWorktree?: (projectId: string) => Promise<WorkspaceBarItem | undefined>
  allProjects?: import("./rail-sidebar").ProjectItem[]
  visibleWorkspaces?: Set<string>
  onToggleWorkspace?: (directory: string, visible: boolean) => void
  class?: string
}

/** Green notification dot for workspaces with activity */
function WorkspaceNotificationDot() {
  return (
    <span class="relative flex" style={{ width: "8px", height: "8px" }}>
      <span
        class="animate-ping absolute inline-flex rounded-full"
        style={{
          width: "8px",
          height: "8px",
          "background-color": "#22c55e",
          opacity: 0.75,
        }}
      />
      <span
        class="relative inline-flex rounded-full"
        style={{
          width: "8px",
          height: "8px",
          "background-color": "#22c55e",
        }}
      />
    </span>
  )
}

/** Project group component - shows project name and its workspaces */
function WorkspaceBarProjectGroup(props: {
  project: WorkspaceBarProject
  defaultDirectory?: string | null
  pinnedDirectory?: string | null
  onWorktreeClick?: (projectId: string, directory: string) => void
  onWorktreeDblClick?: (projectId: string, directory: string) => void
  onProjectClick?: (projectId: string) => void
  onNewWorktree?: (projectId: string) => Promise<WorkspaceBarItem | undefined>
}) {
  const current = () => props.pinnedDirectory ?? props.defaultDirectory
  const [creating, setCreating] = createSignal<"idle" | "loading" | "done">("idle")
  const [createdName, setCreatedName] = createSignal<string | null>(null)

  const handleNewWorktree = async () => {
    if (creating() !== "idle") return
    const handler = props.onNewWorktree
    if (!handler) return

    setCreating("loading")
    try {
      const result = await handler(props.project.id)
      if (result) {
        setCreatedName(result.name)
        setCreating("done")
        // Reset after a short delay
        setTimeout(() => {
          setCreating("idle")
          setCreatedName(null)
        }, 1500)
      } else {
        setCreating("idle")
      }
    } catch {
      setCreating("idle")
    }
  }

  return (
    <div
      class={`group/project flex items-center gap-0 rounded px-2 py-1 -mx-1 transition-colors hover:bg-surface-base-hover/30`}
    >
      {/* Project name - always dim, clicking it selects the project's main workspace */}
      <button
        type="button"
        class="text-[13px] font-medium font-mono text-text-weak transition-colors"
        onClick={() => props.onProjectClick?.(props.project.id)}
      >
        {props.project.name}
      </button>

      {/* Workspaces */}
      <For each={props.project.workspaces}>
        {(ws) => {
          const isCurrent = () => ws.directory === current()
          const isPinned = () => ws.directory === props.pinnedDirectory
          const text = () => (isCurrent() ? "text-text-base font-semibold" : "text-text-weak hover:text-text-base")
          const line = () => (isPinned() ? "underline underline-offset-4" : "")

          return (
            <button
              type="button"
              class={`flex items-center gap-1 px-2 py-1 text-[13px] cursor-pointer ${text()}`}
              onClick={(e) => {
                if (e.detail !== 1) return
                props.onWorktreeClick?.(props.project.id, ws.directory)
              }}
              onDblClick={() => {
                props.onWorktreeDblClick?.(props.project.id, ws.directory)
              }}
            >
              <span class="text-text-weak/50">/</span>
              <span class={line()}>{ws.name}</span>
              <Show when={ws.notification}>
                <WorkspaceNotificationDot />
              </Show>
            </button>
          )
        }}
      </For>

      <Show when={props.onNewWorktree}>
        <Show
          when={creating() === "idle"}
          fallback={
            <div class="flex items-center gap-1 px-2 text-[13px] text-text-weak shrink-0">
              <Show when={creating() === "loading"}>
                <div class="size-3 rounded-full border-2 border-text-weak border-t-transparent animate-spin" />
              </Show>
              <Show when={creating() === "done" && createdName()}>
                <span class="text-text-weak">/</span>
                <span class="text-text-base font-semibold">{createdName()}</span>
                <Icon name="check-small" size="small" class="text-green-500" />
              </Show>
            </div>
          }
        >
          <button
            type="button"
            class="flex items-center justify-center size-6 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover active:bg-surface-base-active transition-colors shrink-0 ml-1"
            onClick={handleNewWorktree}
            aria-label="Create worktree"
          >
            <Icon name="plus-small" size="small" />
          </button>
        </Show>
      </Show>
    </div>
  )
}

/**
 * Workspace bar showing projects and their workspaces.
 * Always displays all workspaces — no hover animation or collapsed state.
 */
export function WorkspaceBar(props: WorkspaceBarProps) {
  const prefix = createMemo(() => (props.pinnedDirectory ? "Filtered by" : "Default workspace"))

  return (
    <div class={`relative h-8 bg-background-base border-b border-border-weak-base/50 ${props.class ?? ""}`}>
      <div class="flex items-center h-full px-3 gap-0">
        <span class="shrink-0 text-[13px] font-medium text-text-weak mr-2 whitespace-nowrap">{prefix()}:</span>
        <div class="flex items-center gap-0 min-w-0 overflow-x-auto no-scrollbar">
          <For each={props.projects}>
            {(project, index) => (
              <>
                <Show when={index() > 0}>
                  <div class="w-px h-5 bg-border-weak-base mx-2 shrink-0" />
                </Show>
                <WorkspaceBarProjectGroup
                  project={project}
                  defaultDirectory={props.defaultDirectory}
                  pinnedDirectory={props.pinnedDirectory}
                  onWorktreeClick={props.onWorktreeClick}
                  onWorktreeDblClick={props.onWorktreeDblClick}
                  onProjectClick={props.onProjectClick}
                  onNewWorktree={props.onNewWorktree}
                />
              </>
            )}
          </For>
        </div>

        {/* More button (three vertical dots) */}
        <Show when={props.allProjects}>
          <div class="flex items-center justify-center ml-2 border-l border-border-weak-base pl-2 shrink-0">
            <Popover
              placement="bottom-end"
              trigger={<Icon name="kebab" size="small" />}
              triggerAs="button"
              triggerProps={{
                class: "flex items-center justify-center size-6 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors cursor-pointer border-none bg-transparent",
              }}
              class="w-[300px] [&_[data-slot=popover-body]]:p-0 [&_[data-slot=list-item]:hover_.ws-delete]:opacity-100 [&_[data-slot=list-item][data-active=true]_.ws-delete]:opacity-100"
            >
              <div class="flex flex-col max-h-[400px]">
                {(() => {
                  // Flatten projects to items
                  const items = createMemo(() => {
                    const list: Array<{
                      id: string
                      name: string
                      directory: string
                      projectId: string
                      projectName: string
                      isMain: boolean
                    }> = []
                    for (const p of props.allProjects ?? []) {
                      // Main
                      list.push({
                        id: p.worktree,
                        name: "main",
                        directory: p.worktree,
                        projectId: p.id,
                        projectName: p.name || getFilename(p.worktree),
                        isMain: true,
                      })
                      // Sandboxes
                      for (const s of p.sandboxes ?? []) {
                        if (s === p.worktree) continue
                        list.push({
                          id: s,
                          name: getFilename(s),
                          directory: s,
                          projectId: p.id,
                          projectName: p.name || getFilename(p.worktree),
                          isMain: false,
                        })
                      }
                    }
                    return list
                  })

                  // Calculate currently visible workspaces (both explicit and implicit)
                  const visibleSet = createMemo(() => {
                    const s = new Set<string>()
                    for (const p of props.projects) {
                      for (const w of p.workspaces) {
                        s.add(w.directory)
                      }
                    }
                    return s
                  })

                  return (
                    <List
                      items={items()}
                      key={(item) => item.directory}
                      groupBy={(item) => item.projectName}
                      search={{ placeholder: "Filter workspaces...", autofocus: true }}
                      onSelect={(item) => {
                        if (!item) return
                        const isVisible = visibleSet().has(item.directory)
                        props.onToggleWorkspace?.(item.directory, !isVisible)
                      }}
                      children={(item) => (
                        <div class="flex items-center gap-2 w-full text-left">
                          <span class="text-text-base truncate flex-1">{item.name}</span>
                          <Show when={!item.isMain && props.onWorktreeDelete}>
                            <button
                              type="button"
                              class="ws-delete flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-critical-base transition-colors shrink-0 opacity-0"
                              onClick={(e) => {
                                e.stopPropagation()
                                props.onWorktreeDelete?.(item.projectId, {
                                  id: item.id,
                                  name: item.name,
                                  directory: item.directory,
                                })
                              }}
                            >
                              <Icon name="trash" size="small" />
                            </button>
                          </Show>
                          <Show when={visibleSet().has(item.directory)}>
                            <span class="inline-flex items-center justify-center shrink-0">
                              <Icon name="check-small" />
                            </span>
                          </Show>
                        </div>
                      )}
                    />
                  )
                })()}
              </div>
            </Popover>
          </div>
        </Show>
      </div>
    </div>
  )
}
