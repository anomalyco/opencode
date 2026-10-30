export type YamlKind = "indent" | "key" | "punctuation" | "string" | "number" | "boolean" | "null" | "fold"
export type YamlSegment = { text: string; kind: YamlKind }

export type MessageBlockRule = { open: string; close: string; format: string }

type Range = { start: number; end: number }
export type MessageSegment =
  | ({ kind: "text" } & Range)
  | ({ kind: "block"; format: string; open: Range; body: Range; close: Range } & Range)

// Message text split into plain stretches and the blocks a rule picks out. A block runs from an
// opening line to the first later closing line; both lines must match whole, surrounding spaces
// aside. In `open`, `*` matches a run of non-space characters, and each `*` in `close` stands for
// what the corresponding `*` in `open` matched, so `[vibeterm_*]` closes only at the
// `[/vibeterm_*]` with the same name. An opening line with no closing line is plain text. The
// first rule whose opening line matches wins. The segments cover the text exactly, in order.
export function messageSegments(text: string, rules: readonly MessageBlockRule[]): MessageSegment[] {
  const compiled = rules.flatMap((rule) => {
    if (!rule.open.trim() || !rule.close.trim()) return []
    const open = new RegExp(`^${rule.open.trim().split("*").map(escape).join("(\\S+)")}$`)
    return [{ ...rule, open }]
  })
  const lines = lineRanges(text)
  const segments: MessageSegment[] = []
  let plain = 0
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const found = compiled.flatMap((rule) => {
      const match = rule.open.exec(text.slice(line.start, line.end).trim())
      if (!match) return []
      const captures = match.slice(1)
      const close = rule.close.trim().replace(/\*/g, () => captures.shift() ?? "*")
      const closing = lines.findIndex((candidate, at) => at > index && text.slice(candidate.start, candidate.end).trim() === close)
      return closing === -1 ? [] : [{ format: rule.format, closing }]
    })[0]
    if (!found) {
      index += 1
      continue
    }
    const closing = lines[found.closing]
    if (line.start > plain) segments.push({ kind: "text", start: plain, end: line.start })
    const bodyStart = Math.min(line.next, closing.start)
    segments.push({
      kind: "block",
      format: found.format,
      start: line.start,
      end: closing.end,
      open: { start: line.start, end: bodyStart },
      body: { start: bodyStart, end: closing.start },
      close: { start: closing.start, end: closing.end },
    })
    plain = closing.end
    index = found.closing + 1
  }
  if (plain < text.length) segments.push({ kind: "text", start: plain, end: text.length })
  return segments
}

// `key: value` lines colored as YAML: the key, its colon, and the value by type. The characters are the body's own, newlines included, so the block reads and wraps as it
// was written. Lines that are not `key: value` are a list item's value or plain string.
export function yamlSegments(body: string): YamlSegment[] {
  return body.split(/(?<=\n)/).flatMap((line): YamlSegment[] => {
    const newline = line.endsWith("\n") ? "\n" : ""
    const content = line.slice(0, line.length - newline.length)
    const end: YamlSegment[] = newline ? [{ text: newline, kind: "indent" }] : []
    if (/^\s*#/.test(content)) return [{ text: content, kind: "fold" }, ...end]
    const match = /^(\s*)(-\s+)?(?:([^\s#:][^:]*?)(:)(?=\s|$))?(\s*)(.*)$/.exec(content)
    if (!match) return [{ text: content, kind: "string" }, ...end]
    const [, indent, dash, key, colon, gap, value] = match
    return [
      { text: indent, kind: "indent" as const },
      { text: dash ?? "", kind: "punctuation" as const },
      { text: key ?? "", kind: "key" as const },
      { text: colon ?? "", kind: "punctuation" as const },
      { text: gap, kind: "indent" as const },
      { text: value, kind: scalarKind(value) },
      ...end,
    ].filter((segment) => segment.text)
  })
}

function scalarKind(value: string): YamlKind {
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value)) return "number"
  if (value === "true" || value === "false") return "boolean"
  if (value === "null" || value === "~") return "null"
  return "string"
}

// Each line's content range and where the next line starts.
function lineRanges(text: string) {
  const ranges: { start: number; end: number; next: number }[] = []
  let start = 0
  while (start <= text.length) {
    const newline = text.indexOf("\n", start)
    const end = newline === -1 ? text.length : newline
    ranges.push({ start, end, next: newline === -1 ? end : end + 1 })
    if (newline === -1) break
    start = newline + 1
  }
  return ranges
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
