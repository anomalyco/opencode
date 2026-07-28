export type SessionTab = {
  sessionID: string
  title?: string
}

export type SessionTabUnread = "activity" | "error"

export function sessionTabComplete(unread: SessionTabUnread | undefined, busy: boolean) {
  return unread === "activity" && !busy
}

export const SESSION_TAB_WIDTH = 22
export const SESSION_TAB_MAX_WIDTH = 32
export const SESSION_TAB_MIN_WIDTH = 8
export const SESSION_TAB_OVERFLOW_WIDTH = 3

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

export function cycleSessionTab(tabs: readonly SessionTab[], active: string | undefined, direction: 1 | -1) {
  if (tabs.length === 0) return
  const index = tabs.findIndex((tab) => tab.sessionID === active)
  const start = index === -1 ? (direction === 1 ? -1 : 0) : index
  return tabs[(start + direction + tabs.length) % tabs.length]
}

export function adaptiveSessionTabLayout(
  tabs: readonly SessionTab[],
  active: string | undefined,
  available: number,
  previousStart = 0,
) {
  if (tabs.length === 0) return { tabs: [], widths: [], before: 0, after: 0, start: 0, total: 0 }

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.sessionID === active),
  )
  const fit = (width: number) =>
    Math.min(tabs.length, Math.max(1, 1 + Math.floor((Math.max(0, width) - SESSION_TAB_WIDTH) / SESSION_TAB_MIN_WIDTH)))
  const solve = (count: number, start: number, attempts: number): { count: number; start: number } => {
    const nextStart = Math.min(
      Math.max(0, activeIndex < start ? activeIndex : activeIndex >= start + count ? activeIndex - count + 1 : start),
      tabs.length - count,
    )
    const markers =
      (nextStart > 0 ? SESSION_TAB_OVERFLOW_WIDTH : 0) +
      (nextStart + count < tabs.length ? SESSION_TAB_OVERFLOW_WIDTH : 0)
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
    available - (before > 0 ? SESSION_TAB_OVERFLOW_WIDTH : 0) - (after > 0 ? SESSION_TAB_OVERFLOW_WIDTH : 0),
  )
  const roomy = contentWidth >= SESSION_TAB_WIDTH * visible.length
  const total = roomy ? Math.min(contentWidth, SESSION_TAB_MAX_WIDTH * visible.length) : contentWidth
  if (roomy) {
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
