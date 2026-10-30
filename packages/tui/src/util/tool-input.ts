export type ToolInputKind = "indent" | "key" | "punctuation" | "string" | "number" | "boolean" | "null" | "fold"
export type ToolInputSegment = { text: string; kind: ToolInputKind }
export type ToolInputRow = ToolInputSegment[]

// The one-line `[key=value, ...]` form a tool's input is shown in by default. It only has room for
// primitive values, so objects and arrays are left out.
export function inlineToolInput(input: Record<string, unknown>, omit?: string[]) {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

// Whether the one-line form shows the whole input readably: nothing but short single-line
// primitives.
export function fitsInline(input: Record<string, unknown>, width = 80) {
  const values = Object.values(input)
  if (values.some((value) => typeof value !== "number" && typeof value !== "boolean" && typeof value !== "string"))
    return false
  if (values.some((value) => typeof value === "string" && value.includes("\n"))) return false
  return inlineToolInput(input).length <= width
}

// A tool's input as YAML-style rows: one key per row, nested objects and arrays ind// A tool's input as compact YAML rows: one key per row, a nested object indented beneath its key,
// a list's `- ` items at their key's indent with the item's other keys aligned under its first,
// strings unquoted with their escapes already decoded (JSON gave us real newlines, tabs and
// quotes), a multi-line string as its own indented lines.
//
// Given a `width`, the input is collapsed instead: every value takes exactly one row of that
// many columns, a multi-line string joined onto it, and a value too long for the row is cut with
// `…` at its end. `overflow` reports whether collapsing hid anything.
export function formatToolInput(input: Record<string, unknown>, width?: number) {
  const rows: ToolInputRow[] = []
  let overflow = false

  const indent = (depth: number): ToolInputSegment => ({ text: "  ".repeat(depth), kind: "indent" })
  const dash = (depth: number): ToolInputSegment[] => [indent(depth), { text: "- ", kind: "punctuation" }]
  const isDash = (head: ToolInputSegment[]) => head.at(-1)?.text === "- "

  function object(value: Record<string, unknown>, depth: number, head?: ToolInputSegment[]) {
    Object.entries(value).forEach(([key, item], index) => {
      const prefix = index === 0 && head ? head : [indent(depth)]
      entry([...prefix, { text: key, kind: "key" }], depth, item)
    })
  }

  // One row: `head` (a key or a list dash), its separator and the value, cut to the row in
  // collapsed mode.
  function row(head: ToolInputSegment[], value: ToolInputSegment) {
    const prefix = isDash(head) ? head : [...head, { text: ": ", kind: "punctuation" as const }]
    if (width === undefined) return rows.push([...prefix, value])
    const room = width - stringWidth(prefix.map((segment) => segment.text).join(""))
    const cut = truncate(value.text, room)
    overflow ||= cut !== value.text
    if (cut === value.text) return rows.push([...prefix, value])
    const kept = cut.slice(0, -1)
    rows.push([...prefix, ...(kept ? [{ ...value, text: kept }] : []), { text: "…", kind: "fold" }])
  }

  // `head` is the row so far, a key or a list dash, without its separator; `depth` is its indent.
  function entry(head: ToolInputSegment[], depth: number, item: unknown) {
    const opened = () => {
      if (isDash(head)) rows.push([...head.slice(0, -1), { text: "-", kind: "punctuation" }])
      else rows.push([...head, { text: ":", kind: "punctuation" }])
    }
    if (typeof item === "string") {
      if (item === "") return row(head, { text: '""', kind: "punctuation" })
      if (!item.includes("\n")) return row(head, { text: item, kind: "string" })
      if (width !== undefined) {
        overflow = true
        return row(head, { text: item.replace(/[ \t]*\n[ \t]*/g, " ").trim(), kind: "string" })
      }
      // A list item's text starts after its dash; a key's text starts on the next row.
      const [first, ...rest] = item.split("\n")
      if (!isDash(head)) opened()
      rows.push([...(isDash(head) ? head : [indent(depth + 1)]), { text: first, kind: "string" }])
      for (const line of rest) rows.push([indent(depth + 1), { text: line, kind: "string" }])
      return
    }
    if (Array.isArray(item)) {
      if (item.length === 0) return row(head, { text: "[]", kind: "punctuation" })
      opened()
      // A list under a key sits at the key's indent; a list inside a list one level in.
      const items = isDash(head) ? depth + 1 : depth
      for (const element of item) {
        if (isRecord(element) && Object.keys(element).length > 0) {
          object(element, items + 1, dash(items))
          continue
        }
        entry(dash(items), items, element)
      }
      return
    }
    if (isRecord(item)) {
      if (Object.keys(item).length === 0) return row(head, { text: "{}", kind: "punctuation" })
      opened()
      object(item, depth + 1)
      return
    }
    row(head, scalar(item))
  }

  object(input, 0)
  return { rows, overflow }
}

// `text` cut to at most `room` columns, its last column a `…` when anything was cut.
function truncate(text: string, room: number) {
  if (stringWidth(text) <= room) return text
  if (room <= 1) return "…"
  let used = 0
  let result = ""
  for (const char of text) {
    const width = stringWidth(char)
    if (used + width > room - 1) break
    result += char
    used += width
  }
  return result + "…"
}

function stringWidth(text: string) {
  return /^[\x20-\x7e]*$/.test(text) ? text.length : Bun.stringWidth(text)
}

function scalar(value: unknown): ToolInputSegment {
  if (typeof value === "number") return { text: String(value), kind: "number" }
  if (typeof value === "boolean") return { text: String(value), kind: "boolean" }
  if (value === null || value === undefined) return { text: "null", kind: "null" }
  return { text: String(value), kind: "string" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Whether a plugin or MCP tool's response is drawn. The generic output toggle decides by default.
// With the input shown as a block (`toolInput`), a response the toggle hides is held instead of
// lost: the call offers to expand, and expanding draws it.
export function toolOutputReach(state: { output: boolean; toggle: boolean; toolInput: boolean; expanded: boolean }) {
  const held = state.output && !state.toggle && state.toolInput
  return { held, shown: (state.output && state.toggle) || (held && state.expanded) }
}
