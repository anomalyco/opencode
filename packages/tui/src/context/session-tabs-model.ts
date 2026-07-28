export type SessionTab = {
  sessionID: string
  title?: string
}

export type SessionTabUnread = "activity" | "error"

export function openSessionTab(tabs: readonly SessionTab[], tab: SessionTab) {
  const index = tabs.findIndex((item) => item.sessionID === tab.sessionID)
  if (index === -1) return [...tabs, tab]
  if (!tab.title || tabs[index]?.title === tab.title) return [...tabs]
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

export function visibleSessionTabs(tabs: readonly SessionTab[], active: string | undefined, limit: number) {
  if (tabs.length <= limit) return [...tabs]
  const count = Math.max(1, limit)
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.sessionID === active),
  )
  const start = Math.min(Math.max(0, index - Math.floor(count / 2)), tabs.length - count)
  return tabs.slice(start, start + count)
}
