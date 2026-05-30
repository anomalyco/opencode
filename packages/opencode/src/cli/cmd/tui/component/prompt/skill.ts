// 'g' flag is required by String.prototype.matchAll; avoid exec/test/match on this object to prevent lastIndex leakage.
const REGEX = /\$([a-zA-Z][a-zA-Z0-9_-]*)/g

function gap(text: string, start: number, end: number) {
  const prev = start === 0 ? "" : text[start - 1]
  const next = text[end] ?? ""
  if (prev && !/(?:\s|\(|\[)/.test(prev)) return false
  if (next && !/(?:\s|\)|\]|\.|,|!|\?|:|;)/.test(next)) return false
  return true
}

export function references(text: string): Array<{ name: string; start: number; end: number; value: string }> {
  const results: Array<{ name: string; start: number; end: number; value: string }> = []
  for (const match of text.matchAll(REGEX)) {
    const name = match[1]
    if (!name) continue
    const start = match.index ?? 0
    const end = start + match[0].length
    if (!gap(text, start, end)) continue
    results.push({ name, start, end, value: match[0] })
  }
  return results
}
