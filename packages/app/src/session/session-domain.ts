import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { beforeRevert } from "@opencode/util/session-revert"

export function selectSessionUserMessages(messages: readonly SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

/** The prompts a revert leaves, by their place in the transcript: message IDs do not sort in that order. */
export function selectVisibleSessionUserMessages(messages: readonly SessionMessageInfo[], revertMessageID?: string) {
  return selectSessionUserMessages(beforeRevert(messages, revertMessageID))
}
