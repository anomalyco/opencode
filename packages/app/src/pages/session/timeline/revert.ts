import type { Message, Part } from "@opencode-ai/sdk/v2"

export type RevertBoundary = {
  messageID: string
  partID?: string
}

export type RevertPreviewState = { ready: false } | { ready: true; nextMessageID?: string }

export function redoTarget(preview: RevertPreviewState) {
  if (!preview.ready) return undefined
  return preview.nextMessageID ?? null
}

export function restoreTarget(
  preview: { items: readonly { id: string }[]; hasMore?: boolean; continuationMessageID?: string },
  messageID: string,
) {
  const index = preview.items.findIndex((item) => item.id === messageID)
  if (index === -1) return undefined
  const next = preview.items[index + 1]?.id
  if (next) return next
  if (preview.continuationMessageID) return preview.continuationMessageID
  if (preview.hasMore) return undefined
  return null
}

export function selectVisibleMessages(messages: Message[], revert?: RevertBoundary) {
  if (!revert) return messages
  const boundary = messages.findIndex((message) => message.id === revert.messageID)
  if (boundary === -1) return []
  return messages.slice(0, boundary + (revert.partID ? 1 : 0))
}

export function selectRevertedMessages(messages: Message[], revert?: RevertBoundary) {
  if (!revert) return []
  const boundary = messages.findIndex((message) => message.id === revert.messageID)
  if (boundary === -1) return []
  const message = messages[boundary]!
  const users = messages.slice(boundary).filter((item) => item.role === "user")
  if (!revert.partID && message.role === "user") return users
  return [message, ...users.filter((item) => item.id !== message.id)]
}

export function visiblePartsForMessage(messageID: string, parts: Part[], revert?: RevertBoundary) {
  if (!revert?.partID || messageID !== revert.messageID) return parts
  const index = parts.findIndex((part) => part.id === revert.partID)
  if (index === -1) return []
  return parts.slice(0, index)
}
