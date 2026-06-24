import type { Part } from "@opencode-ai/sdk/v2"
import type { VoiceProgressSnapshot } from "./api"

export function buildVoiceProgressSnapshot(parts: Part[]): VoiceProgressSnapshot {
  let reads = 0
  let searches = 0
  let lists = 0
  let shell = 0
  let thinking = false

  for (const part of parts) {
    if (part.type === "tool") {
      if (part.tool === "read") reads++
      if (part.tool === "glob" || part.tool === "grep") searches++
      if (part.tool === "list") lists++
      if (part.tool === "bash") shell++
      if (part.state.status === "running" || part.state.status === "pending") thinking = true
    }
    if (part.type === "reasoning") {
      if (!part.time.end) thinking = true
    }
  }

  return { reads, searches, lists, shell, thinking }
}

export function collectActiveTurnParts(input: {
  messages: Array<{ id: string; role: string; parentID?: string }>
  partsForMessage: (messageID: string) => Part[]
  activeUserMessageID?: string
}) {
  if (!input.activeUserMessageID) return []
  const parts: Part[] = []
  for (const message of input.messages) {
    if (message.role !== "assistant") continue
    if (message.parentID !== input.activeUserMessageID) continue
    parts.push(...input.partsForMessage(message.id))
  }
  return parts
}
