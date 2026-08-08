import type { SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client"

export function findUndoBoundary(messages: SessionMessageInfo[], pendingInputIDs: string[], boundary?: string) {
  return messages.findLast(
    (message): message is SessionMessageUser =>
      message.type === "user" &&
      !!message.text.trim() &&
      !pendingInputIDs.includes(message.id) &&
      (!boundary || message.id < boundary),
  )
}
