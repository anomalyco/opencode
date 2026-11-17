import { type SelectedLineRange } from "@pierre/diffs"

type SelectionKey = "ui.sessionReview.selection.line" | "ui.sessionReview.selection.lines"

type SelectionVars = Record<string, string | number>

type Side = SelectedLineRange["side"]

type LineSpan = Pick<SelectedLineRange, "start" | "end">

export function formatSelectedLineLabel(range: LineSpan, t: (key: SelectionKey, params: SelectionVars) => string) {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)

  if (start === end) return t("ui.sessionReview.selection.line", { line: start })

  return t("ui.sessionReview.selection.lines", { start, end })
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
    // Chromium exposes `getSelection` on shadow roots; the DOM types do not list it.
    const shadow: ShadowRoot & { getSelection?: () => Selection | null } = root
    const selection = shadow.getSelection?.() ?? window.getSelection()

    if (!selection) return

    try {
      selection.removeAllRanges()
      selection.addRange(range)
    } catch {}
  })
}
