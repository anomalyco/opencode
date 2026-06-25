import type { Part } from "@opencode-ai/sdk/v2"
import { voiceLogStage } from "./log"

function looksLikeInternalMonologue(text: string) {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  if (/^the user is (asking|requesting|wanting|looking for)\b/.test(normalized)) return true
  if (/^i (need to|should|will|am going to|'ll)\b/.test(normalized)) return true
  if (/\b(in the context of|based on the|let me (check|look|think|see))\b/.test(normalized)) return true
  return normalized.includes("details are on screen") && normalized.length > 72
}

export function looksLikeTrivialVoiceAck(text: string) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return /^(yes|yeah|yep|yup|sure|ok|okay|got it|right|thanks|thank you)\.?$/.test(normalized)
}

export function readSpeakableAssistantText(parts: Part[]) {
  return parts
    .filter(
      (part) =>
        part.type === "text" &&
        !("synthetic" in part && part.synthetic) &&
        !("ignored" in part && part.ignored),
    )
    .map((part) => ("text" in part ? part.text : ""))
    .filter((text) => text.trim() && !looksLikeInternalMonologue(text))
    .join("")
    .trim()
}

export function describeAssistantParts(parts: Part[]) {
  if (parts.length === 0) return "none"
  return parts
    .map((part) => {
      const textLen = "text" in part ? part.text.length : 0
      const synthetic = "synthetic" in part && part.synthetic ? "s" : "-"
      const ignored = "ignored" in part && part.ignored ? "i" : "-"
      return `${part.type}:${textLen}/${synthetic}/${ignored}`
    })
    .join(" ")
}

export function logMissingAssistantReply(input: {
  userID: string | undefined
  users: number
  expected: number
  linked: string[]
  afterUser: string[]
  partsForMessage: (messageID: string) => Part[]
}) {
  for (const messageID of [...input.afterUser, ...input.linked]) {
    const parts = input.partsForMessage(messageID)
    const text = readSpeakableAssistantText(parts)
    voiceLogStage(
      "REPLY",
      `candidate ${messageID} text=${text.length} parts=[${describeAssistantParts(parts)}]`,
    )
  }
}
