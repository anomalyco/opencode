export function parseFileLineRange(input: string) {
  const hash = input.lastIndexOf("#")
  if (hash === -1) return { base: input }

  const base = input.slice(0, hash)
  const match = input.slice(hash + 1).match(/^(\d+)(?:-(\d*))?$/)
  if (!match) return { base }

  const startLine = Number(match[1])
  // `#12` and `#12-12` both name one line; only `#12-` runs to the end of the file. The end line has
  // to reach the server as `?end=`, because an attachment without it covers everything from `start`.
  const endLine =
    match[2] === undefined ? startLine : match[2] === "" ? undefined : Math.max(startLine, Number(match[2]))
  return { base, lineRange: { startLine, endLine } }
}

/** A selection that covers one line still needs its end, or the attachment runs to the end of the file. */
export function mentionLineRange(lineStart: number, lineEnd: number) {
  return { startLine: lineStart, endLine: Math.max(lineStart, lineEnd) }
}

export function formatFileLineRange(file: string, range: { startLine: number; endLine?: number }) {
  if (range.endLine === undefined) return `${file}#${range.startLine}-`
  if (range.endLine === range.startLine) return `${file}#${range.startLine}`
  return `${file}#${range.startLine}-${range.endLine}`
}

export function stripFileLineRange(input: string) {
  return parseFileLineRange(input).base
}

export function parseSlashHead(text: string, separator = /[ \t\n]/) {
  if (!text.startsWith("/")) return

  const end = text.slice(1).search(separator)
  if (end === -1) return { name: text.slice(1), arguments: "", end: text.length }

  const split = end + 1
  return { name: text.slice(1, split), arguments: text.slice(split + 1), end: split }
}
