import type { SessionMessageInfo } from "@opencode/client/promise"

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
