import { Token } from "@/util/token"

type TextPart = {
  type: "text"
  text: string
  synthetic?: boolean
}

type ReasoningPart = {
  type: "reasoning"
  text: string
}

export type MessageContentPart = TextPart | ReasoningPart

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function isTextPart(part: unknown): part is TextPart {
  if (!isRecord(part)) return false
  if (part.type !== "text") return false
  return typeof part.text === "string"
}

function isReasoningPart(part: unknown): part is ReasoningPart {
  if (!isRecord(part)) return false
  if (part.type !== "reasoning") return false
  return typeof part.text === "string"
}

export function pickMessageContentParts(parts: unknown[]) {
  const result: MessageContentPart[] = []
  for (const part of parts) {
    if (isTextPart(part)) {
      result.push(part)
      continue
    }
    if (isReasoningPart(part)) {
      result.push(part)
    }
  }
  return result
}

export function messageText(parts: MessageContentPart[]) {
  const segments: string[] = []

  for (const part of parts) {
    if (part.type === "text" && !part.synthetic) {
      const text = part.text.trim()
      if (text) segments.push(text)
      continue
    }

    if (part.type === "reasoning") {
      const text = part.text.trim()
      if (text) segments.push(`Reasoning:\n${text}`)
      continue
    }
  }

  return segments.join("\n\n").trim()
}

export function estimateMessageTokens(parts: MessageContentPart[]) {
  const text = messageText(parts)
  if (!text) return 0
  return Token.estimate(text)
}
