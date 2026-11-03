/**
 * Each query word must start consecutive title words, case-insensitively. A trailing space asks for one more
 * title word, so `@HOME ` stops matching "HOME" and the popover gives way to prose.
 */
export function matchesSessionTitle(title: string, query: string) {
  const words = query.toLowerCase().split(" ")
  const titleWords = title.toLowerCase().split(/\s+/).filter(Boolean)

  return titleWords.some((_, start) => words.every((word, index) => titleWords[start + index]?.startsWith(word)))
}
