export const HISTORY_TREE_OPEN_WIDTH = 244
export const HISTORY_TREE_CARD_INSET = 8
export const HISTORY_TREE_HEADER = 48
export const HISTORY_TREE_ICON = 28
export const HISTORY_TREE_ICON_GAP = 4
export const HISTORY_TREE_AFTER = 4
export const HISTORY_TREE_TITLE_PAD = 10
export const MAC_TRAFFIC_LIGHTS_WIDTH = 84
export const HISTORY_TREE_EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
export const HISTORY_TREE_MS = 220

export function historyTreeMacLights(platform: {
  platform: string
  os?: string
  windowFullscreen?: () => boolean
}) {
  return platform.platform === "desktop" && platform.os === "macos" && !platform.windowFullscreen?.()
}

export function historyTreeCollapsedStart(macLights: boolean) {
  if (macLights) return MAC_TRAFFIC_LIGHTS_WIDTH
  return HISTORY_TREE_CARD_INSET
}

export function historyTreeWindowChromeStart(macLights: boolean) {
  if (macLights) return MAC_TRAFFIC_LIGHTS_WIDTH
  return HISTORY_TREE_CARD_INSET + HISTORY_TREE_TITLE_PAD
}

// Tree rows keep a fixed gutter; only the header row shifts to clear the macOS traffic lights.
export const HISTORY_TREE_SIDEBAR_INSET = HISTORY_TREE_CARD_INSET + HISTORY_TREE_TITLE_PAD

export function historyTreeChromeOnCard(mobile: boolean, treeOpened: boolean) {
  if (mobile) return true
  return !treeOpened
}

export function historyTreeTitleShift(macLights: boolean) {
  const cluster = HISTORY_TREE_ICON + HISTORY_TREE_AFTER
  return historyTreeWindowChromeStart(macLights) + cluster - HISTORY_TREE_CARD_INSET - HISTORY_TREE_TITLE_PAD
}

export function historyTreeTitlePadding(collapsed: boolean, macLights: boolean) {
  if (!collapsed) return HISTORY_TREE_TITLE_PAD
  return HISTORY_TREE_TITLE_PAD + historyTreeTitleShift(macLights)
}

export function historyTreeWindowToggle(input: {
  mobile: boolean
  treeOpened: boolean
  session: boolean
}) {
  if (input.treeOpened) return false
  // Compact sessions keep the toggle in the title bar, same as the collapsed
  // desktop tree. Home still needs the in-window control.
  if (input.mobile && input.session) return false
  return true
}
