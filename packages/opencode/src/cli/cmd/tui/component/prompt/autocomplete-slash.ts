export type Slash = {
  start: number
  end: number
  query: string
}

const blank = (char: string) => /\s/.test(char)
const slash = /\/(\S*)$/

export function scan(text: string, cursor: number) {
  if (cursor <= 0 || cursor > text.length) return

  const match = text.slice(0, cursor).match(slash)
  if (!match) return

  const start = match.index ?? cursor - match[0].length
  let end = cursor

  while (end < text.length && !blank(text[end]!)) end += 1

  return {
    start,
    end,
    query: text.slice(start + 1, cursor),
  } satisfies Slash
}

export function splice(text: string, start: number, end: number, next: string) {
  return text.slice(0, start) + next + text.slice(end)
}
