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

type CompletedToolPart = {
  type: "tool"
  tool: string
  state: {
    status: "completed"
    output: string
  }
}

export type MessageContentPart = TextPart | ReasoningPart | CompletedToolPart

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

function isCompletedToolPart(part: unknown): part is CompletedToolPart {
  if (!isRecord(part)) return false
  if (part.type !== "tool") return false
  const state = part.state
  if (!isRecord(state)) return false
  if (state.status !== "completed") return false
  return typeof state.output === "string" && typeof part.tool === "string"
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
      continue
    }
    if (isCompletedToolPart(part)) {
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

    if (part.type === "tool" && part.state.status === "completed") {
      const text = part.state.output.trim()
      if (text) segments.push(`Tool ${part.tool}:\n${text}`)
    }
  }

  return segments.join("\n\n").trim()
}

export function estimateMessageTokens(parts: MessageContentPart[]) {
  const text = messageText(parts)
  if (!text) return 0
  return Token.estimate(text)
}
