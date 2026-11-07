import type { SessionMessageInfo, SessionMessageUser } from "@Mackery6969/client/promise"

export function selectSessionUserMessages(messages: SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

export function selectVisibleSessionUserMessages(messages: SessionMessageUser[], revertMessageID?: string) {
  if (!revertMessageID) return messages

  return messages.filter((message) => message.id < revertMessageID)
}
