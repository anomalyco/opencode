import { Binary } from "@opencode-ai/core/util/binary"
import type { AssistantMessage, Message, Part, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2"
import { closureEvidencePart } from "@opencode-ai/session-ui/closure-record"

export function closureTimelineMessageID(message: UserMessage, parts: Part[]) {
  if (!closureEvidencePart(message, parts)) return
  return message.id
}

export function selectActiveTimelineMessageID(messages: Message[], userMessages: UserMessage[], status: SessionStatus) {
  const parentID = messages.findLast(
    (message): message is AssistantMessage =>
      message.role === "assistant" && typeof message.time.completed !== "number",
  )?.parentID
  if (parentID) {
    const result = Binary.search(userMessages, parentID, (message) => message.id)
    const message = result.found ? userMessages[result.index] : userMessages.find((item) => item.id === parentID)
    if (message) return message.id
  }

  if (status.type === "idle") return
  return userMessages.at(-1)?.id
}

export function selectTimelineUserMessages(
  messages: Message[],
  userMessages: UserMessage[],
  parts: (messageID: string) => Part[],
) {
  const human = new Set(userMessages.map((message) => message.id))
  return messages.filter((message): message is UserMessage => {
    if (message.role !== "user") return false
    return human.has(message.id) || !!closureEvidencePart(message, parts(message.id))
  })
}
