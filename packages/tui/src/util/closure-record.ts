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

export function isMessageNavigationStop(message: Message, parts: Part[]) {
  if (isCompleteClosurePair({ info: message, parts })) return false
  return parts.some((part) => part.type === "text" && !part.synthetic && !part.ignored)
}

export function transcriptStatus(message: Message | undefined, parts: Part[]): "idle" | "working" {
  if (!message || isCompleteClosurePair({ info: message, parts })) return "idle"
  if (message.role === "user") return "working"
  return message.time.completed ? "idle" : "working"
}

export function taskSpinnerRunning(
  partStatus: string,
  background: boolean,
  sessionStatus: { type: string } | undefined,
) {
  return partStatus === "running" || (background && sessionStatus !== undefined && sessionStatus.type !== "idle")
}
