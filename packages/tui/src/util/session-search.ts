export type SessionSearchMessage = {
  id: string
  role: "user" | "assistant"
}

export type SessionSearchPart = {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}

export type SessionSearchMatch = {
  messageID: string
  role: "user" | "assistant"
  text: string
}

export function findSessionSearchMatches(
  messages: readonly SessionSearchMessage[],
  parts: Record<string, readonly SessionSearchPart[] | undefined>,
  query: string,
): SessionSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []

  return messages.flatMap((message) => {
    const text = messageSearchText(parts[message.id] ?? [])
    if (!text.toLocaleLowerCase().includes(needle)) return []
    return [
      {
        messageID: message.id,
        role: message.role,
        text,
      },
    ]
  })
}

export function nextSessionSearchIndex(total: number, current: number, direction: "next" | "previous") {
  if (total <= 0) return -1
  const offset = direction === "next" ? 1 : -1
  return (current + offset + total) % total
}

export function sessionSearchPreview(text: string, query: string, max = 80) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized

  const index = normalized.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())
  if (index === -1) return normalized.slice(0, max - 1) + "..."

  const half = Math.floor((max - 3) / 2)
  const start = Math.max(0, index - half)
  const end = Math.min(normalized.length, start + max - 3)
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`
}

function messageSearchText(parts: readonly SessionSearchPart[]) {
  return parts
    .flatMap((part) => {
      if (part.type !== "text") return []
      if (part.synthetic || part.ignored) return []
      const text = part.text?.trim()
      return text ? [text] : []
    })
    .join("\n\n")
}
