import type { Message, UserMessage } from "@/types"

export function normalizeSessionTab(tab: string, normalizeFileTab: (tab: string) => string) {
  if (!tab.startsWith("file://")) return tab
  return normalizeFileTab(tab)
}

export function normalizeSessionTabs(tabs: string[], normalize: (tab: string) => string) {
  return [...new Set(tabs.map(normalize))]
}

export function selectSessionUserMessages(messages: Message[]) {
  return messages.filter((message): message is UserMessage => message.role === "user")
}

export function selectVisibleSessionUserMessages(messages: UserMessage[], revertMessageID?: string) {
  if (!revertMessageID) return messages
  const boundary = messages.findIndex((message) => message.id === revertMessageID)
  return boundary < 0 ? messages : messages.slice(0, boundary)
}
