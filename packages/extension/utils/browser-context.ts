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

/**
 * Message types for communication between sidepanel, background, and content scripts
 */
export type CaptureMessageType =
  | "GET_TABS_WITH_GROUPS"
  | "CAPTURE_SCREENSHOT"
  | "CAPTURE_PAGE_MARKDOWN"
  | "CAPTURE_SELECTION_MARKDOWN"

export interface CaptureMessage {
  type: CaptureMessageType
  tabId?: number
}

export interface CaptureResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
