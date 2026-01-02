/**
 * Browser Context Utilities
 * Types and functions for capturing browser context (tabs, screenshots, selections)
 */

export interface TabInfo {
  id: number
  title: string
  url: string
  favIconUrl?: string
  active: boolean
  groupId?: number
  groupColor?: string
  groupTitle?: string
}

export interface TabGroup {
  id: number
  title: string
  color: string
  tabs: TabInfo[]
}

export interface GroupedTabs {
  groups: TabGroup[]
  ungrouped: TabInfo[]
}

export interface WindowInfo {
  id: number
  focused: boolean
  type: string
  tabs: GroupedTabs
}

export interface BrowserTree {
  windows: WindowInfo[]
  totalTabs: number
  focusedWindowId: number | null
}

// Chrome tab group colors mapping
const TAB_GROUP_COLORS: Record<string, string> = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#1e8e3e",
  pink: "#d01884",
  purple: "#9334e6",
  cyan: "#007b83",
  orange: "#fa903e",
}

/**
 * Get all tabs in the current window with group information
 */
export async function getCurrentWindowTabs(): Promise<GroupedTabs> {
  const tabs = await chrome.tabs.query({ currentWindow: true })
  const tabGroups = await getTabGroups()

  const groupMap = new Map<number, TabGroup>()
  const ungrouped: TabInfo[] = []

  // Initialize groups
  for (const group of tabGroups) {
    groupMap.set(group.id, {
      id: group.id,
      title: group.title || "",
      color: TAB_GROUP_COLORS[group.color] || group.color,
      tabs: [],
    })
  }

  // Assign tabs to groups
  for (const tab of tabs) {
    const tabInfo: TabInfo = {
      id: tab.id!,
      title: tab.title || "Untitled",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl,
      active: tab.active,
      groupId: tab.groupId !== -1 ? tab.groupId : undefined,
    }

    if (tab.groupId !== undefined && tab.groupId !== -1) {
      const group = groupMap.get(tab.groupId)
      if (group) {
        tabInfo.groupColor = group.color
        tabInfo.groupTitle = group.title
        group.tabs.push(tabInfo)
      } else {
        ungrouped.push(tabInfo)
      }
    } else {
      ungrouped.push(tabInfo)
    }
  }

  return {
    groups: Array.from(groupMap.values()).filter((g) => g.tabs.length > 0),
    ungrouped,
  }
}

/**
 * Get tab groups for the current window
 */
async function getTabGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  if (!chrome.tabGroups) return []
  const [currentWindow] = await chrome.windows.getAll({ windowTypes: ["normal"] })
  if (!currentWindow?.id) return []
  return chrome.tabGroups.query({ windowId: currentWindow.id })
}

/**
 * Get the currently active tab
 */
export async function getActiveTab(): Promise<TabInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return null

  return {
    id: tab.id,
    title: tab.title || "Untitled",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl,
    active: true,
    groupId: tab.groupId !== -1 ? tab.groupId : undefined,
  }
}

/**
 * Capture a screenshot of the visible area of a tab
 */
export async function captureScreenshot(tabId?: number): Promise<string> {
  // If tabId provided, we need to activate that tab first
  if (tabId) {
    await chrome.tabs.update(tabId, { active: true })
    // Brief delay to allow tab to become visible
    await new Promise((r) => setTimeout(r, 100))
  }

  return chrome.tabs.captureVisibleTab({ format: "png" })
}

/**
 * Check if a URL can be captured (not a protected page)
 */
export function canCaptureUrl(url: string): boolean {
  if (!url) return false
  const protectedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "moz-extension://",
    "file://",
    "devtools://",
  ]
  return !protectedPrefixes.some((prefix) => url.startsWith(prefix))
}

async function getTabGroupsForWindow(windowId: number): Promise<chrome.tabGroups.TabGroup[]> {
  if (!chrome.tabGroups) return []
  return chrome.tabGroups.query({ windowId })
}

function organizeTabsIntoGroups(tabs: chrome.tabs.Tab[], tabGroups: chrome.tabGroups.TabGroup[]): GroupedTabs {
  const groupMap = new Map<number, TabGroup>()
  const ungrouped: TabInfo[] = []

  for (const group of tabGroups) {
    groupMap.set(group.id, {
      id: group.id,
      title: group.title || "",
      color: TAB_GROUP_COLORS[group.color] || group.color,
      tabs: [],
    })
  }

  for (const tab of tabs) {
    const tabInfo: TabInfo = {
      id: tab.id!,
      title: tab.title || "Untitled",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl,
      active: tab.active,
      groupId: tab.groupId !== -1 ? tab.groupId : undefined,
    }

    if (tab.groupId !== undefined && tab.groupId !== -1) {
      const group = groupMap.get(tab.groupId)
      if (group) {
        tabInfo.groupColor = group.color
        tabInfo.groupTitle = group.title
        group.tabs.push(tabInfo)
      } else {
        ungrouped.push(tabInfo)
      }
    } else {
      ungrouped.push(tabInfo)
    }
  }

  return {
    groups: Array.from(groupMap.values()).filter((g) => g.tabs.length > 0),
    ungrouped,
  }
}

export async function getAllWindowsTabs(): Promise<BrowserTree> {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] })
  const allTabs = await chrome.tabs.query({})

  let totalTabs = 0
  let focusedWindowId: number | null = null

  const windowInfos: WindowInfo[] = []

  for (const win of windows) {
    if (!win.id) continue

    if (win.focused) {
      focusedWindowId = win.id
    }

    const windowTabs = allTabs.filter((t) => t.windowId === win.id)
    const tabGroups = await getTabGroupsForWindow(win.id)
    const organized = organizeTabsIntoGroups(windowTabs, tabGroups)

    totalTabs += windowTabs.length

    windowInfos.push({
      id: win.id,
      focused: win.focused,
      type: win.type || "normal",
      tabs: organized,
    })
  }

  return {
    windows: windowInfos,
    totalTabs,
    focusedWindowId,
  }
}

const COLOR_EMOJI: Record<string, string> = {
  grey: "⚪",
  blue: "🔵",
  red: "🔴",
  yellow: "🟡",
  green: "🟢",
  pink: "🩷",
  purple: "🟣",
  cyan: "🩵",
  orange: "🟠",
}

function getColorEmoji(color: string): string {
  const normalized = color.toLowerCase()
  return COLOR_EMOJI[normalized] || "⚪"
}

export function formatTabTree(tree: BrowserTree): string {
  const lines: string[] = []

  lines.push("# Browser Context")
  lines.push("")
  lines.push(
    `**${tree.totalTabs} tabs** across **${tree.windows.length} window${tree.windows.length !== 1 ? "s" : ""}**`,
  )
  lines.push("")

  for (let i = 0; i < tree.windows.length; i++) {
    const win = tree.windows[i]
    const windowLabel = win.focused ? `Window ${i + 1} (focused)` : `Window ${i + 1}`
    lines.push(`## ${windowLabel}`)
    lines.push("")

    for (const group of win.tabs.groups) {
      const emoji = getColorEmoji(group.color)
      const groupName = group.title || "Unnamed Group"
      lines.push(`### ${emoji} ${groupName}`)

      for (const tab of group.tabs) {
        const active = tab.active ? " *(active)*" : ""
        lines.push(`- [${tab.title}](${tab.url})${active}`)
      }
      lines.push("")
    }

    if (win.tabs.ungrouped.length > 0) {
      if (win.tabs.groups.length > 0) {
        lines.push("### Other Tabs")
      }

      for (const tab of win.tabs.ungrouped) {
        const active = tab.active ? " *(active)*" : ""
        lines.push(`- [${tab.title}](${tab.url})${active}`)
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}

/**
 * Message types for communication between sidepanel, background, and content scripts
 */
export type CaptureMessageType =
  | "GET_TABS_WITH_GROUPS"
  | "CAPTURE_SCREENSHOT"
  | "CAPTURE_FULL_PAGE_SCREENSHOT"
  | "CAPTURE_PAGE_MARKDOWN"
  | "CAPTURE_SELECTION_MARKDOWN"
  | "CAPTURE_TAB_TREE"

export interface CaptureMessage {
  type: CaptureMessageType
  tabId?: number
}

export interface CaptureResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
