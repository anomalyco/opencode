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
