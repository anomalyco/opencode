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
  const boundary = messages.findIndex((message) => message.id === revertMessageID)
  return boundary < 0 ? [] : messages.slice(0, boundary)
}

export async function loadRevertBoundary(input: {
  messageID: string
  messages: () => SessionMessageUser[]
  more: () => boolean
  loadMore: () => Promise<void>
}): Promise<SessionMessageUser[] | undefined> {
  const messages = input.messages()
  if (messages.some((message) => message.id === input.messageID)) return messages
  if (!input.more()) return undefined
  await input.loadMore()
  return loadRevertBoundary(input)
}

export async function loadUndoTarget(
  input: Parameters<typeof loadRevertBoundary>[0],
): Promise<{ message: SessionMessageUser; previous?: SessionMessageUser } | undefined> {
  const messages = input.messages()
  const boundary = messages.findIndex((message) => message.id === input.messageID)
  const more = input.more()
  if (boundary >= 2 || (boundary === 1 && !more)) {
    const message = messages[boundary - 1]
    if (!message) return undefined
    return { message, previous: boundary > 1 ? messages[boundary - 2] : undefined }
  }
  if (!more) return undefined
  await input.loadMore()
  return loadUndoTarget(input)
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
