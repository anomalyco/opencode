import { type SelectedLineRange } from "@pierre/diffs"

type PointerMode = "none" | "text" | "numbers"
type Side = SelectedLineRange["side"]
type LineSpan = Pick<SelectedLineRange, "start" | "end">

export function formatSelectedLineLabel(range: LineSpan) {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  if (start === end) return `line ${start}`
  return `lines ${start}-${end}`
}

export function previewSelectedLines(source: string, range: LineSpan) {
  const start = Math.max(1, Math.min(range.start, range.end))
  const end = Math.max(range.start, range.end)
  const lines = source.split("\n").slice(start - 1, end)
  if (lines.length === 0) return
  return lines.slice(0, 2).join("\n")
}

export function cloneSelectedLineRange(range: SelectedLineRange): SelectedLineRange {
  const next: SelectedLineRange = {
    start: range.start,
    end: range.end,
  }

  if (range.side) next.side = range.side
  if (range.endSide) next.endSide = range.endSide
  return next
}

export function lineInSelectedRange(range: SelectedLineRange | null | undefined, line: number, side?: Side) {
  if (!range) return false

  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  if (line < start || line > end) return false
  if (!side) return true

  const first = range.side
  const last = range.endSide ?? first
  if (!first && !last) return true
  if (!first || !last) return (first ?? last) === side
  if (first === last) return first === side
  if (line === start) return first === side
  if (line === end) return last === side
  return true
}

export function isSingleLineSelection(range: SelectedLineRange | null) {
  if (!range) return false
  return range.start === range.end && (range.endSide == null || range.endSide === range.side)
}

export function toRange(source: Range | StaticRange): Range {
  if (source instanceof Range) return source
  const range = new Range()
  range.setStart(source.startContainer, source.startOffset)
  range.setEnd(source.endContainer, source.endOffset)
  return range
}

export function restoreShadowTextSelection(root: ShadowRoot | undefined, range: Range | undefined) {
  if (!root || !range) return

  requestAnimationFrame(() => {
    const selection =
      (root as unknown as { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection()
    if (!selection) return

    try {
      selection.removeAllRanges()
      selection.addRange(range)
    } catch {}
  })
}

export function createLineNumberSelectionBridge() {
  let mode: PointerMode = "none"
  let line: number | undefined
  let moved = false
  let pending = false

  const clear = () => {
    mode = "none"
    line = undefined
    moved = false
  }

  return {
    begin(numberColumn: boolean, next: number | undefined) {
      if (!numberColumn) {
        mode = "text"
        return
      }

      mode = "numbers"
      line = next
      moved = false
    },
    track(buttons: number, next: number | undefined) {
      if (mode !== "numbers") return false

      if ((buttons & 1) === 0) {
        clear()
        return true
      }

      if (next !== undefined && line !== undefined && next !== line) moved = true
      return true
    },
    finish() {
      const current = mode
      pending = current === "numbers" && moved
      clear()
      return current
    },
    consume(range: SelectedLineRange | null) {
      const result = pending && !isSingleLineSelection(range)
      pending = false
      return result
    },
    reset() {
      pending = false
      clear()
    },
  }
}
