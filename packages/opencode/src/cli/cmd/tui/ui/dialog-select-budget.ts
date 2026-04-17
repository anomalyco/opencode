import { Locale } from "@/util/locale"

// pad (10) reserves dialog chrome: left+right padding + borders.
// Single-line fallback caps at 61 chars (default DialogSelect title budget).
// Multi-line total caps at 122 chars to stay readable on 80-col terminals.
export function budget(width: number, tail: number, lines: number) {
  const pad = 10
  const span = Math.max(width - pad, 0)
  if (lines === 1) return span === 0 ? 1 : 61
  const perLine = Math.max(span - tail, 1)
  return Math.min(Math.max(perLine * lines, 1), 122)
}

type WrapState = {
  lines: string[]
  truncated: boolean
}

const grapheme = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function measure(text: string) {
  return Bun.stringWidth(text)
}

function sliceWidth(text: string, width: number) {
  if (width <= 0) return ""
  let result = ""
  for (const part of grapheme.segment(text)) {
    if (measure(result + part.segment) > width) break
    result += part.segment
  }
  return result
}

function splitWidth(text: string, width: number, limit: number) {
  const result: string[] = []
  let rest = text
  while (rest && result.length < limit) {
    const next = sliceWidth(rest, width)
    if (!next) break
    result.push(next)
    rest = rest.slice(next.length)
  }
  return { parts: result, truncated: rest.length > 0 }
}

export function wrap(text: string, width: number, tail: number, maxLines: number) {
  const normalized = text.replace(/[^\S ]+/g, " ")
  const limit = budget(width, 0, 1)
  if (maxLines === 1) return Locale.truncate(normalized, limit)
  const perLine = Math.max(width - 10 - tail, 1)
  const tokens = normalized.match(/\s+|\S+/g) ?? []
  const state = tokens.reduce<WrapState>(
    (current, token) => {
      if (current.truncated) return current
      const line = current.lines.at(-1) ?? ""
      const next = `${line}${token}`
      if (measure(next) <= perLine) {
        const lines = current.lines.slice(0, -1).concat(next)
        return { lines, truncated: false }
      }
      if (/^\s+$/.test(token)) return current
      if (line.length === 0) {
        const available = maxLines - current.lines.length + 1
        const split = splitWidth(token, perLine, available)
        const parts = split.parts
        const lines = current.lines.slice(0, -1).concat(parts)
        return { lines, truncated: split.truncated }
      }
      if (current.lines.length >= maxLines) {
        return { lines: current.lines, truncated: true }
      }
      if (measure(token) > perLine) {
        const available = maxLines - current.lines.length
        const split = splitWidth(token, perLine, available)
        const parts = split.parts
        const lines = current.lines.slice(0, -1).concat(line.trimEnd(), parts)
        return { lines, truncated: split.truncated }
      }
      const lines = current.lines.slice(0, -1).concat(line.trimEnd(), token)
      return { lines, truncated: false }
    },
    { lines: [""], truncated: false },
  )
  const joined = state.lines.join("\n")
  if (!state.truncated) return joined
  const ellipsis = perLine <= 3 ? ".".repeat(perLine) : "..."
  const room = Math.max(perLine - measure(ellipsis), 0)
  const last = state.lines.at(-1) ?? ""
  const head = sliceWidth(last, room).trimEnd()
  const lines = state.lines.slice(0, -1).concat(`${head}${ellipsis}`)
  return lines.join("\n")
}
