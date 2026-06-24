import type { Part } from "@opencode-ai/sdk/v2"
import { voiceLogStage } from "./log"

export function readSpeakableAssistantText(parts: Part[]) {
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part ? part.text : ""))
    .join("")
    .trim()
  if (text) return text

  return parts
    .filter((part) => part.type === "reasoning")
    .map((part) => ("text" in part ? part.text.replace("[REDACTED]", "").trim() : ""))
    .filter(Boolean)
    .join("\n")
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
