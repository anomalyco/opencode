type Item = {
  name: string
  content: string
}

// 'g' flag is required by String.prototype.matchAll; avoid exec/test/match on this object to prevent lastIndex leakage.
const REGEX = /\$([a-zA-Z][a-zA-Z0-9_-]*)/g

function body(item: Item) {
  return `## Skill: ${item.name}\n\n${item.content.trim()}`
}

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

export function has(text: string) {
  for (const match of text.matchAll(REGEX)) {
    const name = match[1]
    const start = match.index ?? 0
    const end = start + match[0].length
    if (!name || !gap(text, start, end)) continue
    return true
  }
  return false
}

export function expand(text: string, get: (name: string) => Item | undefined): string {
  const seen = new Set<string>()
  const bodies: string[] = []
  for (const match of text.matchAll(REGEX)) {
    const name = match[1]
    if (!name || seen.has(name)) continue
    const start = match.index ?? 0
    const end = start + match[0].length
    if (!gap(text, start, end)) continue
    const item = get(name)
    if (!item) continue
    seen.add(name)
    bodies.push(body(item))
  }
  if (bodies.length === 0) return text
  return bodies.join("\n\n") + "\n\n" + text
}
