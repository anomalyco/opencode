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
import {
  SortableProvider,
  createSortable,
  createDroppable,
} from "@thisbeyond/solid-dnd"
import { useClaxedoLayout, type TabItem, type TabType } from "../context/claxedo-layout"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useLanguage } from "@opencode-ai/claxedo-app"
import { getTerminalCommands } from "../../components/settings-terminals"
import { getFilename } from "@opencode-ai/util/path"

// Loading indicator - pulsing dot
const PULSE_INTERVAL = 500
const HOLD_TO_DELETE_MS = 1000

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
  badge?: { text: string; tip: string }
  isActive: boolean
  onClose: (tabId: string) => void
  onSelect?: (tab: TabItem) => void
  onSetActive: (tabId: string) => void
  onDblClick: (dir: string) => void
  onContextMenu?: (e: MouseEvent, tabId: string) => void
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

        <Show when={props.badge}>
          {(b) => (
            <Tooltip value={`${props.tab.title} — ${b().tip}`}>
              <span class="w-4 flex items-center justify-center opacity-0 group-hover/title:opacity-100 text-text-weak">
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

  // Use group-specific tabs when groupId is provided, otherwise backward-compatible topTabs
  const tabs = createMemo(() => props.groupId ? claxedo.groupTabs(props.groupId) : claxedo.topTabs)
  const wt = createMemo(() => props.groupId ? claxedo.groupWorktree(props.groupId) : claxedo.worktree)

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

  const badge = (tab: TabItem) => {
    if (pinned()) return
    const info = props.worktreeInfo?.(tab.directory)
    if (!info || info.isMain) return
    return { text: info.name, tip: info.tooltip ?? `Worktree: ${info.name}` }
  }

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
            {/* Desktop: layout icon */}
            <IconButton
              icon={props.sidebarPinned ? "layout-left-full" : "layout-left-partial"}
              variant="ghost"
              class="shrink-0 mr-2 rounded hidden md:flex"
              onClick={() => props.onSidebarToggle?.()}
              aria-label={props.sidebarPinned ? "Hide Sidebar" : "Show Sidebar"}
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
          <For each={visibleTabs()}>
            {(tab, index) => (
              <>
                <Show when={index() > 0}>
                  <div class="w-px h-10 bg-border-weak-base flex-shrink-0" />
                </Show>
                <SortableTab
                  tab={tab}
                  badge={badge(tab)}
                  isActive={tabs().activeId() === tab.id}
                  onClose={handleTabClose}
                  onSelect={props.onTabSelect}
                  onSetActive={handleTabSetActive}
                  onDblClick={handleTabDblClick}
                  onContextMenu={handleTabContextMenu}
                />
              </>
            )}
          </For>
        </SortableProvider>

        {/* Action buttons - immediately after tabs */}
        <Show when={wt().default() || active()?.directory}>
          <div class="flex items-center gap-0 flex-shrink-0 h-10">
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

      {/* Tab context menu */}
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
            <>
              <div class="fixed inset-0 z-[300]" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }} />
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
            </>
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
  onWorktreeDelete?: (projectId: string, workspace: WorkspaceBarItem) => Promise<void> | void
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
          const canDelete = () => ws.canDelete !== false
          const text = () => (isCurrent() ? "text-text-base font-semibold" : "text-text-weak hover:text-text-base")
          const line = () => (isPinned() ? "underline underline-offset-4" : "")
          const [phase, setPhase] = createSignal<"idle" | "hold" | "loading" | "done" | "fail">("idle")
          const [showX, setShowX] = createSignal(false)
          let timer: number | undefined
          let xTimer: number | undefined

          const clear = () => {
            if (timer) window.clearTimeout(timer)
            if (xTimer) window.clearTimeout(xTimer)
            timer = undefined
            xTimer = undefined
            setShowX(false)
            if (phase() === "hold") setPhase("idle")
          }

          onCleanup(clear)

          const start = (e: PointerEvent) => {
            // Temporarily disabled for debugging: if (!canDelete()) return
            if (e.button !== 0) return
            if (phase() !== "idle") return
            setPhase("hold")
            // Show X icon at 50% (400ms of 800ms)
            xTimer = window.setTimeout(() => {
              setShowX(true)
            }, HOLD_TO_DELETE_MS / 2)
            timer = window.setTimeout(() => {
              timer = undefined
              xTimer = undefined
              const del = props.onWorktreeDelete
              if (!del) {
                setPhase("idle")
                setShowX(false)
                return
              }
              setPhase("loading")
              setShowX(false)
              Promise.resolve(del(props.project.id, ws))
                .then(() => setPhase("done"))
                .catch(() => setPhase("fail"))
                .finally(() => window.setTimeout(() => setPhase("idle"), 900))
            }, HOLD_TO_DELETE_MS)
          }

          const stop = () => {
            if (phase() !== "hold") return
            clear()
          }

          return (
            <button
              type="button"
              class={`relative overflow-hidden flex items-center gap-1 px-2 py-1 text-[13px] cursor-pointer ${text()}`}
              onPointerDown={start}
              onPointerUp={stop}
              onPointerCancel={stop}
              onPointerLeave={stop}
              onClick={(e) => {
                if (phase() !== "idle") return
                if (e.detail !== 1) return
                props.onWorktreeClick?.(props.project.id, ws.directory)
              }}
              onDblClick={() => {
                if (phase() !== "idle") return
                props.onWorktreeDblClick?.(props.project.id, ws.directory)
              }}
            >
              <Show when={phase() === "hold" || phase() === "idle"}>
                <div
                  class="absolute inset-y-0 left-0 pointer-events-none"
                  style={{
                    "background-color": "rgba(239, 68, 68, 0.4)",
                    width: phase() === "hold" ? "100%" : "0%",
                    transition: phase() === "hold" ? `width ${HOLD_TO_DELETE_MS}ms linear` : "width 150ms ease-out",
                  }}
                  aria-hidden="true"
                />
              </Show>
              <span class="text-text-weak/50">/</span>
              <span class={`relative z-10 ${line()}`}>{ws.name}</span>
              <Show when={phase() === "loading"}>
                <div class="relative z-10 size-3 rounded-full border-2 border-text-weak border-t-transparent animate-spin" />
              </Show>
              <Show when={phase() === "done"}>
                <span class="relative z-10 text-text-base">
                  <Icon name="check-small" size="small" />
                </span>
              </Show>
              <Show when={phase() === "fail"}>
                <span class="relative z-10 text-text-weak">
                  <Icon name="circle-x" size="small" />
                </span>
              </Show>
              <Show when={ws.notification && phase() === "idle"}>
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
 * Workspace bar showing projects and their workspaces
 * Multi-project cards separated by dividers, with notification dots for activity
 */
export function WorkspaceBar(props: WorkspaceBarProps) {
  const claxedo = useClaxedoLayout()
  const [open, setOpen] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const [snap, setSnap] = createSignal<{ prefix: string; projects: WorkspaceBarProject[] } | null>(null)
  const [creating, setCreating] = createSignal<"idle" | "loading" | "done">("idle")
  const [createdName, setCreatedName] = createSignal<string | null>(null)
  const project = createMemo(() => {
    if (!props.projects.length) return
    const active = props.activeProjectId
    if (!active) return props.projects[0]
    return props.projects.find((p) => p.id === active) ?? props.projects[0]
  })

  const handleNewWorktree = async () => {
    if (creating() !== "idle") return
    const p = project()
    if (!p) return
    const handler = props.onNewWorktree
    if (!handler) return

    setCreating("loading")
    try {
      const result = await handler(p.id)
      if (result) {
        setCreatedName(result.name)
        setCreating("done")
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

  const prefix = createMemo(() => (props.pinnedDirectory ? "Filtered by" : "Default workspace"))
  const selected = createMemo(() => props.pinnedDirectory ?? props.defaultDirectory ?? null)
  const current = createMemo(() => {
    const dir = selected()
    if (!dir) return
    const proj = props.projects.find((p) => p.workspaces.some((w) => w.directory === dir))
    if (!proj) return { dir, project: getFilename(dir), workspace: getFilename(dir) }
    const ws = proj.workspaces.find((w) => w.directory === dir)
    return { dir, project: proj.name, workspace: ws?.name ?? getFilename(dir) }
  })

  const expanded = createMemo(() => {
    const cur = selected()
    return props.projects
      .map((proj) => {
        const dirs = claxedo.workspaceRecency.getRecent(proj.id, 10)
        const list = (() => {
          if (!cur) return dirs
          if (!proj.workspaces.some((w) => w.directory === cur)) return dirs
          if (dirs.includes(cur)) return dirs
          return [cur, ...dirs]
        })()

        const workspaces = list
          .map((dir) => proj.workspaces.find((w) => w.directory === dir))
          .filter((x): x is WorkspaceBarItem => !!x)

        if (!workspaces.length) return
        return { ...proj, workspaces }
      })
      .filter((x): x is WorkspaceBarProject => !!x)
  })

  const label = createMemo(() => {
    const s = snap()
    if (s) return s.prefix
    return prefix()
  })

  const list = createMemo(() => {
    const s = snap()
    const next = expanded()
    if (!s) return next

    const cur = selected()
    const ids = new Set(next.map((p) => p.id))
    const set = new Set(s.projects.map((p) => p.id))

    return [
      ...s.projects
        .filter((p) => ids.has(p.id))
        .map((p) => {
          const n = next.find((x) => x.id === p.id)
          if (!n) return p

          const keep = new Set(n.workspaces.map((w) => w.directory))
          const workspaces = p.workspaces.filter((w) => keep.has(w.directory))

          const seen = new Set(workspaces.map((w) => w.directory))
          const add = n.workspaces.filter((w) => !seen.has(w.directory))
          if (!add.length) return { ...p, workspaces }

          const head = cur ? add.find((w) => w.directory === cur) : undefined
          if (!head) return { ...p, workspaces: [...workspaces, ...add] }
          return {
            ...p,
            workspaces: [head, ...workspaces, ...add.filter((w) => w.directory !== head.directory)],
          }
        }),
      ...next.filter((p) => !set.has(p.id)),
    ]
  })

  const toggle = () => {
    const next = !open()
    setOpen(next)
    if (next) {
      if (!snap()) setSnap({ prefix: prefix(), projects: expanded() })
      return
    }

    if (!hover()) setSnap(null)
  }

  return (
    <div
      class={`group/workspace-bar relative h-8 bg-background-base border-b border-border-weak-base/50 ${props.class ?? ""}`}
      data-open={open() ? "" : undefined}
      data-hover={hover() ? "" : undefined}
    >
      <div class="flex items-center h-full px-3 gap-0 transition-opacity duration-150 opacity-70 group-data-[hover]/workspace-bar:opacity-100 group-data-[open]/workspace-bar:opacity-100 max-md:opacity-100">
        <div class="flex items-center gap-0 min-w-0 overflow-x-auto no-scrollbar flex-1">
          {/* Default workspace / filter summary (integrated into the left switcher) */}
          <Show when={current()}>
            {(cur) => (
              <div
                class="mr-3 flex items-center gap-2 text-[13px] font-medium text-text-weak whitespace-nowrap overflow-hidden text-ellipsis max-w-[420px] group-data-[hover]/workspace-bar:max-w-[900px] group-data-[hover]/workspace-bar:overflow-visible group-data-[open]/workspace-bar:max-w-[900px] group-data-[open]/workspace-bar:overflow-visible shrink-0 max-md:max-w-none max-md:overflow-x-auto"
                style={{ transition: "max-width 700ms cubic-bezier(0.22, 1, 0.36, 1)" }}
                onMouseEnter={() => {
                  setHover(true)
                  if (snap()) return
                  setSnap({ prefix: prefix(), projects: expanded() })
                }}
                onMouseLeave={() => {
                  setHover(false)
                  if (open()) return
                  setSnap(null)
                }}
              >
                <button
                  type="button"
                  class="shrink-0 z-10 bg-background-base transition-colors hover:text-text-base"
                  aria-expanded={open()}
                  onClick={toggle}
                >
                  {label()}:
                </button>
                <div class="flex items-center min-w-0 overflow-hidden">
                  {/* Collapsed summary - fades out (sheath) */}
                  <div
                    class="flex items-center min-w-0 z-10 bg-background-base max-w-[420px] overflow-hidden text-ellipsis group-data-[hover]/workspace-bar:max-w-0 group-data-[hover]/workspace-bar:opacity-0 group-data-[hover]/workspace-bar:pointer-events-none group-data-[open]/workspace-bar:max-w-0 group-data-[open]/workspace-bar:opacity-0 group-data-[open]/workspace-bar:pointer-events-none max-md:hidden"
                    style={{
                      transition: "max-width 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease-out 100ms",
                    }}
                  >
                    <span class="font-mono">{cur().project}</span> -{" "}
                    <span
                      classList={{
                        "text-text-base font-semibold": true,
                        "underline underline-offset-4": props.pinnedDirectory === cur().dir,
                      }}
                    >
                      {cur().workspace}
                    </span>
                  </div>

                  {/* Expanded content - slides in from left (sword extending) */}
                  <div
                    class="flex items-center min-w-0 max-w-0 overflow-hidden opacity-0 pointer-events-none -translate-x-full group-data-[hover]/workspace-bar:max-w-[900px] group-data-[hover]/workspace-bar:overflow-visible group-data-[hover]/workspace-bar:opacity-100 group-data-[hover]/workspace-bar:pointer-events-auto group-data-[hover]/workspace-bar:translate-x-0 group-data-[open]/workspace-bar:max-w-[900px] group-data-[open]/workspace-bar:overflow-visible group-data-[open]/workspace-bar:opacity-100 group-data-[open]/workspace-bar:pointer-events-auto group-data-[open]/workspace-bar:translate-x-0 max-md:max-w-none max-md:overflow-visible max-md:opacity-100 max-md:pointer-events-auto max-md:translate-x-0"
                    style={{
                      transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease-out 100ms",
                    }}
                  >
                    <For each={list()}>
                      {(project, index) => (
                        <>
                          <Show when={index() > 0}>
                            {/* Divider between projects */}
                            <div class="w-px h-5 bg-border-weak-base mx-2 shrink-0" />
                          </Show>
                          <WorkspaceBarProjectGroup
                            project={project}
                            defaultDirectory={props.defaultDirectory}
                            pinnedDirectory={props.pinnedDirectory}
                            onWorktreeClick={props.onWorktreeClick}
                            onWorktreeDblClick={props.onWorktreeDblClick}
                            onWorktreeDelete={props.onWorktreeDelete}
                            onProjectClick={props.onProjectClick}
                            onNewWorktree={props.onNewWorktree}
                          />
                        </>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <div
            class="min-w-0 overflow-hidden max-w-[100px] group-data-[hover]/workspace-bar:max-w-0 group-data-[hover]/workspace-bar:opacity-0 group-data-[hover]/workspace-bar:pointer-events-none group-data-[open]/workspace-bar:max-w-0 group-data-[open]/workspace-bar:opacity-0 group-data-[open]/workspace-bar:pointer-events-none max-md:hidden"
            style={{ transition: "max-width 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease-out 100ms" }}
          >
            <Show
              when={creating() === "idle"}
              fallback={
                <div class="flex items-center gap-1 px-2 text-[13px] text-text-weak shrink-0 ml-2">
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
                class="flex items-center justify-center size-6 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover active:bg-surface-base-active transition-colors shrink-0 ml-2"
                classList={{ "opacity-50": !project(), "pointer-events-none": !project() }}
                onClick={handleNewWorktree}
                aria-label="Create worktree"
              >
                <Icon name="plus-small" size="small" />
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
