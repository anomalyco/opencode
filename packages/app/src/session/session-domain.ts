import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"

export function selectSessionUserMessages(messages: SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

/**
 * The latest prompt, unless the model has already answered it with text or a tool call, or something else has run
 * since: a shell command, a compaction and a synthetic prompt each start a run of their own.
 */
export function selectUnansweredPrompt(messages: SessionMessageInfo[]) {
  const index = messages.findLastIndex((message) => message.type === "user")
  const message = messages[index]

  if (message?.type !== "user") return

  const answered = messages.slice(index + 1).some((item) => {
    if (item.type === "shell" || item.type === "compaction" || item.type === "synthetic") return true

    return (
      item.type === "assistant" &&
      item.content.some((part) => part.type === "tool" || (part.type === "text" && part.text.trim() !== ""))
    )
  })

  return answered ? undefined : message
}

export function selectVisibleSessionUserMessages(messages: SessionMessageUser[], revertMessageID?: string) {
  if (!revertMessageID) return messages

  return messages.filter((message) => message.id < revertMessageID)
}
