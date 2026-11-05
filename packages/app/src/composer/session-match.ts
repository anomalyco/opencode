/**
 * Ranks a title against a typed query: 0 for the exact title, 1 when the title starts with the query, 2 when a later
 * title word does, and undefined otherwise. Each query word must start consecutive title words, case-insensitively.
 * A trailing space asks for one more title word, so `@HOME ` stops matching "HOME" and the popover gives way to prose.
 */
export function rankSessionTitle(title: string, query: string) {
  if (title.toLowerCase() === query.toLowerCase()) return 0
  const words = query.toLowerCase().split(" ")
  const titleWords = title.toLowerCase().split(/\s+/).filter(Boolean)

  const start = titleWords.findIndex((_, start) =>
    words.every((word, index) => titleWords[start + index]?.startsWith(word)),
  )

  if (start < 0) return

  return start === 0 ? 1 : 2
}
