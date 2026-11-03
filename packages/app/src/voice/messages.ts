import type { SessionMessageInfo } from "@opencode/client/promise"
import { parseVoiceDelegation } from "@/session/timeline/voice-delegation"

// Responses keeps tool outputs in subsequent rounds. Only conversational text
// belongs in its history preview, never reasoning, attachments or tool output.
export function messageExcerpts(messages: readonly SessionMessageInfo[]) {
  return messages.flatMap((message) => {
    if (message.type !== "assistant" && message.type !== "user" && message.type !== "synthetic") return []

    const text =
      message.type === "assistant"
        ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
        : message.text

    return [{ id: message.id, role: message.type, text: text.slice(0, 400) }]
  })
}

/**
 * A session's recent conversation as lines for the voice agent, oldest first, like the iOS app's: a voice delegation
 * shows the user's own words, and each line is a short excerpt.
 */
export function recentLines(messages: readonly SessionMessageInfo[]) {
  return messages.flatMap((message) => {
    if (message.type !== "assistant" && message.type !== "user") return []

    const text =
      message.type === "assistant"
        ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
        : (parseVoiceDelegation(message.text)?.instruction ?? message.text)

    const line = text.replace(/\s+/g, " ").trim()

    if (!line) return []

    return [`${message.type}: ${line.length > 400 ? `${line.slice(0, 399)}…` : line}`]
  })
}
