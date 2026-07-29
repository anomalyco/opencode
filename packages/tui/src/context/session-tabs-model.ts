export type SessionTab = {
  sessionID: string
  title?: string
}

export type SessionTabUnread = "activity" | "error"

export type SessionTabHistory = {
  entries: readonly string[]
  index: number
}

export function sessionTabComplete(unread: SessionTabUnread | undefined, busy: boolean) {
  return unread === "activity" && !busy
}

export const SESSION_TAB_WIDTH = 22
export const SESSION_TAB_MAX_WIDTH = 32
export const SESSION_TAB_MIN_WIDTH = 8
// Overflow markers reserve one gap cell beside the arrow and count, e.g. "‹12 " and " 12›".
export const sessionTabOverflowWidth = (count: number) => String(count).length + 2

export function openSessionTab(tabs: SessionTab[], tab: SessionTab): SessionTab[] {
  const index = tabs.findIndex((item) => item.sessionID === tab.sessionID)
  if (index === -1) return [...tabs, tab]
  if (!tab.title || tabs[index]?.title === tab.title) return tabs
  return tabs.map((item, position) => (position === index ? { ...item, title: tab.title } : item))
}

export function closeSessionTab(tabs: readonly SessionTab[], sessionID: string) {
  const index = tabs.findIndex((tab) => tab.sessionID === sessionID)
  if (index === -1) return { tabs: [...tabs], next: undefined }
  return {
    tabs: tabs.filter((tab) => tab.sessionID !== sessionID),
    next: tabs[index + 1]?.sessionID ?? tabs[index - 1]?.sessionID,
  }
}

export function moveSessionTab(tabs: SessionTab[], sessionID: string, index: number): SessionTab[] {
  const from = tabs.findIndex((tab) => tab.sessionID === sessionID)
  const to = Math.max(0, Math.min(tabs.length - 1, index))
  if (from === -1 || from === to) return tabs
  const next = tabs.filter((tab) => tab.sessionID !== sessionID)
  next.splice(to, 0, tabs[from])
  return next
}

export function cycleSessionTab(tabs: readonly SessionTab[], active: string | undefined, direction: 1 | -1) {
  if (tabs.length === 0) return
  const index = tabs.findIndex((tab) => tab.sessionID === active)
  const start = index === -1 ? (direction === 1 ? -1 : 0) : index
  return tabs[(start + direction + tabs.length) % tabs.length]
}

export function recordSessionTabHistory(history: SessionTabHistory, sessionID: string): SessionTabHistory {
  if (history.entries[history.index] === sessionID) return history
  const entries = [...history.entries.slice(0, history.index + 1), sessionID]
  return { entries, index: entries.length - 1 }
}

export function moveSessionTabHistory(
  history: SessionTabHistory,
  tabs: readonly SessionTab[],
  active: string | undefined,
  direction: 1 | -1,
) {
  if (!active) {
    const sessionID = history.entries[history.index]
    return tabs.some((tab) => tab.sessionID === sessionID) ? { history, sessionID } : { history, sessionID: undefined }
  }
  const entries = history.entries.map((sessionID, index) => ({ sessionID, index }))
  const candidates = direction === -1 ? entries.slice(0, history.index).reverse() : entries.slice(history.index + 1)
  const target = candidates.find(
    (entry) => entry.sessionID !== active && tabs.some((tab) => tab.sessionID === entry.sessionID),
  )
  if (!target) return { history, sessionID: undefined }
  return { history: { ...history, index: target.index }, sessionID: target.sessionID }
}

export type SessionTabMotionValues = {
  widths: number[]
  selections: number[]
  activities: number[]
}

/**
 * Seed width motion for a visible-tab membership change: retained tabs keep their current animated
 * values and first-seen tabs grow in from zero width. Returns undefined when nothing is retained,
 * meaning the window was fully replaced and the strip should jump.
 */
export function seedSessionTabMotion(
  previous: readonly string[],
  ids: readonly string[],
  current: SessionTabMotionValues,
  next: SessionTabMotionValues,
): SessionTabMotionValues | undefined {
  const positions = ids.map((id) => previous.indexOf(id))
  if (positions.every((position) => position === -1)) return undefined
  return {
    widths: positions.map((position, index) =>
      position === -1 ? 0 : (current.widths[position] ?? next.widths[index] ?? 0),
    ),
    selections: positions.map(
      (position, index) => (position === -1 ? next.selections[index] : current.selections[position]) ?? 0,
    ),
    activities: positions.map(
      (position, index) => (position === -1 ? next.activities[index] : current.activities[position]) ?? 0,
    ),
  }
}

export function adaptiveSessionTabLayout(
  tabs: readonly SessionTab[],
  active: string | undefined,
  available: number,
  previousStart = 0,
) {
  if (tabs.length === 0) return { tabs: [], widths: [], before: 0, after: 0, start: 0, total: 0 }

  const activeIndex = tabs.findIndex((tab) => tab.sessionID === active)
  const fit = (width: number) =>
    Math.min(
      tabs.length,
      Math.max(
        1,
        activeIndex === -1
          ? Math.floor(Math.max(0, width) / SESSION_TAB_MIN_WIDTH)
          : 1 + Math.floor((Math.max(0, width) - SESSION_TAB_WIDTH) / SESSION_TAB_MIN_WIDTH),
      ),
    )
  const solve = (count: number, start: number, attempts: number): { count: number; start: number } => {
    const boundedStart = Math.min(Math.max(0, start), tabs.length - count)
    const nextStart = Math.min(
      Math.max(
        0,
        activeIndex === -1
          ? boundedStart
          : activeIndex < boundedStart
            ? activeIndex
            : activeIndex >= boundedStart + count
              ? activeIndex - count + 1
              : boundedStart,
      ),
      tabs.length - count,
    )
    const markers =
      (nextStart > 0 ? sessionTabOverflowWidth(nextStart) : 0) +
      (nextStart + count < tabs.length ? sessionTabOverflowWidth(tabs.length - nextStart - count) : 0)
    const nextCount = fit(available - markers)
    if (nextCount === count || attempts === 0) return { count, start: nextStart }
    return solve(nextCount, nextStart, attempts - 1)
  }
  const solved = solve(fit(available), previousStart, 3)
  const visible = tabs.slice(solved.start, solved.start + solved.count)
  const before = solved.start
  const after = tabs.length - solved.start - solved.count
  const contentWidth = Math.max(
    1,
    available - (before > 0 ? sessionTabOverflowWidth(before) : 0) - (after > 0 ? sessionTabOverflowWidth(after) : 0),
  )
  const roomy = contentWidth >= SESSION_TAB_WIDTH * visible.length
  const total = roomy ? Math.min(contentWidth, SESSION_TAB_MAX_WIDTH * visible.length) : contentWidth
  if (roomy || activeIndex === -1) {
    const width = Math.floor(total / visible.length)
    const remainder = total - width * visible.length
    return {
      tabs: visible,
      widths: visible.map((_, index) => width + Number(index < remainder)),
      before,
      after,
      start: solved.start,
      total,
    }
  }
  const inactiveWidth =
    visible.length === 1
      ? 0
      : Math.min(
          SESSION_TAB_WIDTH,
          Math.max(
            SESSION_TAB_MIN_WIDTH,
            Math.floor((total - Math.min(SESSION_TAB_WIDTH, total)) / (visible.length - 1)),
          ),
        )
  const activeWidth = visible.length === 1 ? total : total - inactiveWidth * (visible.length - 1)

  return {
    tabs: visible,
    widths: visible.map((tab) => (tab.sessionID === active ? activeWidth : inactiveWidth)),
    before,
    after,
    start: solved.start,
    total,
  }
}
