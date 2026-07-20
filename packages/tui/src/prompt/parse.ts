export function parseFileLineRange(input: string) {
  const hash = input.lastIndexOf("#")
  if (hash === -1) return { base: input }

  const base = input.slice(0, hash)
  const match = input.slice(hash + 1).match(/^(\d+)(?:-(\d*))?$/)
  if (!match) return { base }

  const startLine = Number(match[1])
  const endLine = match[2] && startLine < Number(match[2]) ? Number(match[2]) : undefined
  return { base, lineRange: { startLine, endLine } }
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
