type Item = {
  name: string
  content: string
}

type Span = {
  start: number
  end: number
  text: string
}

// 'g' flag is required by String.prototype.matchAll; avoid exec/test/match on this object to prevent lastIndex leakage.
const REGEX = /\$([a-zA-Z][a-zA-Z0-9_-]*)/g

function body(item: Item) {
  return `## Skill: ${item.name}\n\n${item.content.trim()}`
}

function wrap(text: string, start: number, end: number, value: string) {
  const prev = start === 0 ? "" : text[start - 1]
  const next = text[end] ?? ""
  const pre = !prev || prev === "\n" ? "" : "\n"
  const post = !next || /\s/.test(next) ? "" : "\n"
  return `${pre}${value}${post}`
}

function gap(text: string, start: number, end: number) {
  const prev = start === 0 ? "" : text[start - 1]
  const next = text[end] ?? ""
  if (prev && !/(?:\s|\(|\[)/.test(prev)) return false
  if (next && !/(?:\s|\)|\]|\.|,|!|\?|:|;)/.test(next)) return false
  return true
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
  const spans: Span[] = []
  for (const match of text.matchAll(REGEX)) {
    const name = match[1]
    const start = match.index ?? 0
    const end = start + match[0].length
    if (!name || !gap(text, start, end)) continue
    const item = get(name)
    if (!item) continue
    spans.push({ start, end, text: wrap(text, start, end, body(item)) })
  }
  if (spans.length === 0) return text
  return spans
    .toSorted((a, b) => b.start - a.start)
    .reduce((acc, item) => acc.slice(0, item.start) + item.text + acc.slice(item.end), text)
}
