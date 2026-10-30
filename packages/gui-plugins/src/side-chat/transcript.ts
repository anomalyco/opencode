/** The lowest positive number no open side chat uses, so closing "Side chat 1" lets the next one take it again. */
export function nextOrdinal(chats: readonly { readonly ordinal: number }[]) {
  const used = new Set(chats.map((chat) => chat.ordinal))

  return Array.from({ length: chats.length + 1 }, (_, index) => index + 1).find((ordinal) => !used.has(ordinal)) ?? 1
}

/**
 * The messages a side chat shows: everything after the last one its fork inherited. When `base` is not among the
 * loaded messages, the loaded window starts after it, so all of them belong to the chat.
 */
export function ownMessages<T extends { readonly id: string }>(messages: readonly T[], base: string) {
  return messages.slice(messages.findIndex((message) => message.id === base) + 1)
}

/** Markdown for a quotation, one `>` per line. Empty for a blank selection. */
export function quoteText(value: string) {
  const text = value.replace(/\r\n?/g, "\n").trim()

  if (!text) return ""

  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}
