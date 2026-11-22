import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client"

export function findUndoMessage(
  messages: readonly SessionMessageInfo[],
  admitted: ReadonlySet<string>,
  pending: ReadonlySet<string>,
) {
  return messages.findLast(
    (message): message is SessionMessageUser =>
      message.type === "user" &&
      !!message.text.trim() &&
      (!admitted.has(message.id) || pending.has(message.id)),
  )
}
