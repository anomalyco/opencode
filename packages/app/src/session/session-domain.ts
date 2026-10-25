import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"

export function selectSessionUserMessages(messages: SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

// A revert can be staged on any message, including an assistant one, so cut before selecting user messages.
export function selectVisibleSessionUserMessages(messages: SessionMessageInfo[], revertMessageID?: string) {
  return selectSessionUserMessages(revertMessageID ? messagesBefore(messages, revertMessageID) : messages)
}

// Message lists are in server sequence order, but IDs do not sort by it: forked IDs end in `_<seq>`, so `_10`
// sorts before `_9`, and iOS mints mixed-case IDs. An ID missing from a loaded list is older than all of it.
export function messagesBefore<T extends { id: string }>(messages: T[], id: string) {
  const index = messages.findIndex((message) => message.id === id)

  return index < 0 ? [] : messages.slice(0, index)
}
