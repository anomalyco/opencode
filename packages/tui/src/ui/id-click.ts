import { TextareaRenderable } from "@opentui/core"

// Session and message IDs are copied when clicked wherever they are drawn: in
// the sidebar, and in what the AI and tools wrote. The ID is read back from
// the cells on screen, inside the renderable that was clicked, so it
// is found the way it reads, after markdown concealment and syntax colouring,
// and never runs into the next column. Prompt text is left to the caret.

const PATTERN = /^(ses|msg)_[0-9A-Za-z]{10,}$/
const KINDS = { ses: "session", msg: "message" } as const

type Cells = { width: number; height: number; buffers: { char: Uint32Array } }
type Area = { x: number; y: number; width: number; height: number }

// What a row shows between two columns, one character per cell. Cells that
// are not a single code point (wide-character halves, graphemes) read as U+FFFD,
// so a column is still its index.
export function cellText(cells: Cells, y: number, left: number, right: number) {
  const from = Math.max(0, left)
  const to = Math.min(cells.width, right)
  if (y < 0 || y >= cells.height || to <= from) return ""
  return Array.from({ length: to - from }, (_, index) => {
    const code = cells.buffers.char[y * cells.width + from + index]
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd"
  }).join("")
}

export function idAt(cells: Cells, x: number, y: number, area?: Area) {
  const top = Math.max(0, area?.y ?? 0)
  const bottom = Math.min(cells.height, area ? area.y + area.height : cells.height)
  const left = Math.max(0, area?.x ?? 0)
  const right = Math.min(cells.width, area ? area.x + area.width : cells.width)
  if (y < top || y >= bottom || x < left || x >= right) return
  const at = (column: number) => cells.buffers.char[y * cells.width + column]
  if (!word(at(x))) return
  const start = scan(x, -1, (column) => column >= left && word(at(column))) + 1
  const end = scan(x, 1, (column) => column < right && word(at(column)))
  const value = String.fromCharCode(...Array.from({ length: end - start }, (_, index) => at(start + index)))
  const match = PATTERN.exec(value)
  if (!match) return
  return { kind: KINDS[match[1] as keyof typeof KINDS], value }
}

// The ID under a click, if any. Element handlers that act on a click call this
// first and stand down, so one click on an ID never also opens or toggles what
// contains it.
export function idUnder(cells: Cells, event: { x: number; y: number; target: Area | null }) {
  const target = event.target
  if (!target || target instanceof TextareaRenderable) return
  return idAt(cells, event.x, event.y, target)
}

function scan(from: number, step: number, inside: (column: number) => boolean): number {
  const next = from + step
  return inside(next) ? scan(next, step, inside) : next
}

// ASCII letters, digits and underscore. Cells holding wide or combined
// characters carry flag bits above the code point and end the word.
function word(code: number | undefined) {
  if (code === undefined) return false
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
}
