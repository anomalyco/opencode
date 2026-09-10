import { isCompleteClosurePair } from "@opencode-ai/core/session/closure-record"
import type { Message, Part, TextPart, UserMessage } from "@opencode-ai/sdk/v2"

export type MessageParts = (messageID: string) => Part[]

export function closureEvidencePart(message: Message, parts: Part[]): TextPart | undefined {
  if (!isCompleteClosurePair({ info: message, parts })) return
  const part = parts[0]
  if (part?.type !== "text") return
  return part
}

export function isHumanUserMessage(message: Message, parts: Part[]): message is UserMessage {
  return message.role === "user" && !isCompleteClosurePair({ info: message, parts })
}

export function selectHumanUserMessages(messages: Message[], parts: MessageParts): UserMessage[] {
  return messages.filter((message): message is UserMessage => isHumanUserMessage(message, parts(message.id)))
}

export function partitionUserTranscript(messages: Message[], parts: MessageParts) {
  const human: UserMessage[] = []
  const evidence: UserMessage[] = []
  const visible: UserMessage[] = []

  for (const message of messages) {
    if (message.role !== "user") continue
    visible.push(message)
    if (closureEvidencePart(message, parts(message.id))) {
      evidence.push(message)
      continue
    }
    human.push(message)
  }

  return { human, evidence, visible }
}
