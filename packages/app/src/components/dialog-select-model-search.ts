export const normalizeModelSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")

export const compactModelSearch = (value: string) => normalizeModelSearch(value).replaceAll(" ", "")

export const abbreviationModelSearch = (value: string) =>
  normalizeModelSearch(value)
    .split(/\W+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")

// Try matching query against model name words as a mix of word-prefixes and initials.
// "deepseekv4" → prefix "deepseek" + prefix "v4"
// "deepff" → prefix "deep" + initial "f" + initial "f"
// "dvff" → initial "d" + initial "v" + initial "f" + initial "f"
const matchWordsPrefixOrInitial = (query: string, words: string[], wi: number): boolean => {
  if (!query) return true
  if (wi >= words.length) return false

  const word = words[wi]
  // Try skipping this word
  if (matchWordsPrefixOrInitial(query, words, wi + 1)) return true

  // Try matching a prefix of this word (1 to min(query.length, word.length) chars)
  const maxLen = Math.min(query.length, word.length)
  for (let len = 1; len <= maxLen; len++) {
    if (query.slice(0, len) !== word.slice(0, len)) break
    if (matchWordsPrefixOrInitial(query.slice(len), words, wi + 1)) return true
  }
  return false
}

export const matchesModelSearch = (query: string, values: string[]) => {
  const search = normalizeModelSearch(query)
  if (!search) return true

  const compactSearch = compactModelSearch(query)
  return values.some((value) => {
    if (normalizeModelSearch(value).includes(search)) return true
    if (compactModelSearch(value).includes(compactSearch)) return true

    // Abbreviation matching: treat query as a mix of word-prefixes and word-initials.
    const words = normalizeModelSearch(value)
      .split(/\W+/)
      .filter(Boolean)
    return matchWordsPrefixOrInitial(compactSearch, words, 0)
  })
}
