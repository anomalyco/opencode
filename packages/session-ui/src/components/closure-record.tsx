import { isCompleteClosurePair } from "@opencode-ai/core/session/closure-record"
import type { Message, Part, TextPart, UserMessage } from "@opencode-ai/sdk/v2"

export function closureEvidencePart(message: Message, parts: Part[]): TextPart | undefined {
  if (!isCompleteClosurePair({ info: message, parts })) return
  const part = parts[0]
  if (part?.type !== "text") return
  return part
}

export function isHumanUserMessage(message: Message, parts: Part[]): message is UserMessage {
  return message.role === "user" && !isCompleteClosurePair({ info: message, parts })
}
