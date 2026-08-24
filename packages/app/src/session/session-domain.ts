import type { SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"

export function normalizeSessionTab(tab: string, normalizeFileTab: (tab: string) => string) {
  if (!tab.startsWith("file://")) return tab
  return normalizeFileTab(tab)
}

export function normalizeSessionTabs(tabs: string[], normalize: (tab: string) => string) {
  return [...new Set(tabs.map(normalize))]
}

export function selectSessionUserMessages(messages: SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

export function selectVisibleSessionUserMessages(messages: SessionMessageUser[], revertMessageID?: string) {
  if (!revertMessageID) return messages
  return messages.filter((message) => message.id < revertMessageID)
}

export function removedSessionIDs(sessions: readonly { id: string; parentID?: string }[], sessionID: string) {
  const removed = new Set([sessionID])
  const byParent = Map.groupBy(
    sessions.filter((session) => session.parentID),
    (session) => session.parentID!,
  )
  const visit = (id: string) =>
    byParent.get(id)?.forEach((child) => {
      if (removed.has(child.id)) return
      removed.add(child.id)
      visit(child.id)
    })
  visit(sessionID)
  return removed
}
