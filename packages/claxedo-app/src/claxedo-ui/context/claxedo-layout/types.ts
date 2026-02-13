export type TabType = "session" | "terminal" | "review" | "file"

export type TabItem = {
  id: string
  type: TabType
  directory: string
  title: string
  sessionId?: string
  terminalId?: string
  filePath?: string
  badge?: {
    additions: number
    deletions: number
  }
  closable: boolean
  pinned?: boolean
  loading?: boolean
  attention?: boolean
  done?: boolean
}

export type RailState = {
  collapsed: boolean
  hovered: boolean
  pinned: boolean
  locked: boolean
}

export type TopTabsState = {
  items: TabItem[]
  activeId: string | null
  order: string[]
  closedTabs: TabItem[]
}

export type WorktreeState = {
  default: string | null
  pinned: string | null
}

export type PaneDir = "h" | "v"

export type Pane = { t: "leaf"; id: string } | { t: "split"; dir: PaneDir; a: Pane; b: Pane; size: number }

export type TerminalActionOrigin = { tabId: string; groupId: string; hostId: string }

export type TerminalAgentStatus = "idle" | "working" | "permission"

export type TerminalLifecycleState = "creating" | "attaching" | "attached" | "closing" | "closed"

export type GroupLayoutState = {
  fileTree: { opened: boolean; width: number; tab: "changes" | "all" }
  session: { width: number; collapsed: boolean; panelMode: number }
  reviewPanel: { opened: boolean }
}

export const defaultGroupLayout = (): GroupLayoutState => ({
  fileTree: { opened: true, width: 344, tab: "changes" },
  session: { width: 600, collapsed: false, panelMode: 0 },
  reviewPanel: { opened: false },
})

export type GroupState = {
  id: string
  tabs: TopTabsState
  worktree: WorktreeState
  layout: GroupLayoutState
}

export type SplitState = {
  direction: "h" | "v"
  sizes: number[]
  focusedId: string
  hidden?: boolean
}

export type ClaxedoLayoutStore = {
  rail: RailState
  groups: GroupState[]
  split: SplitState
  enabled: boolean
  terminalPane: Record<string, Pane | undefined>
  terminalFocus: Record<string, string | undefined>
  terminalZoom: Record<string, string | undefined>
  terminalOwner: Record<string, string | undefined>
  terminalAgentStatus: Record<string, TerminalAgentStatus | undefined>
  terminalAgentSeen: Record<string, true | undefined>
  terminalLifecycle: Record<string, TerminalLifecycleState | undefined>
  workspaceRecency: Record<string, string[]>
}

export const createEmptyTabsState = (): TopTabsState => ({
  items: [],
  activeId: null,
  order: [],
  closedTabs: [],
})
