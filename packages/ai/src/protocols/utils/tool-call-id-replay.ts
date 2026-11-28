import type { LLMRequest } from "../../schema/index.js"

// Allocate per occurrence, after the target's formatter, without rewriting stored IDs.
export const normalizer = (request: LLMRequest, format = (id: string) => id) => {
  const reserved = new Set(
    request.messages.flatMap((message) =>
      message.role === "assistant"
        ? message.content.flatMap((part) => (part.type === "tool-call" ? [format(part.id)] : []))
        : [],
    ),
  )
  const used = new Set<string>()
  const seen = new Set<string>()
  const ids = new Map<string, string>()
  const project = (id: string) => ids.get(id) ?? format(id)
  let next = 0

  return (message: LLMRequest["messages"][number]) => {
    if (message.role === "user" || message.role === "assistant") ids.clear()
    if (message.role !== "assistant") return project

    const calls = message.content.filter((part) => part.type === "tool-call")
    const ambiguous = new Set(calls.map((part) => part.id)).size !== calls.length
    for (const part of calls) {
      const formatted = format(part.id)
      // Same-message duplicates have no unambiguous result pairing. Leave just this group as-is.
      if (ambiguous) {
        used.add(formatted)
        seen.add(part.id)
        continue
      }
      let id = formatted
      if (seen.has(part.id) || used.has(formatted)) {
        // Nine alphanumeric characters also fit Mistral's existing wire format.
        do {
          id = (next++).toString(36).padStart(9, "0")
        } while (used.has(id) || reserved.has(id))
      }
      seen.add(part.id)
      used.add(id)
      ids.set(part.id, id)
    }
    return project
  }
}

export * as ToolCallIDReplay from "./tool-call-id-replay.js"
