const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function promptOffsetWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    // Textarea offsets count newlines as one position; Bun.stringWidth counts them as zero.
    width += part.segment === "\n" ? 1 : Bun.stringWidth(part.segment)
  }
  return width
}

export function displayOffsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0

  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (next > offset) return part.index
    width = next
  }

  return value.length
}

export function displaySlice(value: string, start = 0, end = promptOffsetWidth(value)) {
  return value.slice(displayOffsetIndex(value, start), displayOffsetIndex(value, end))
}

export function displayCharAt(value: string, offset: number) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (offset === width || offset < next) return part.segment
    width = next
  }
}

export function mentionTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const text = displaySlice(value, 0, offset)
  const index = text.lastIndexOf("@")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return promptOffsetWidth(text.slice(0, index))
  }
}

/** Snap a display-width offset to the nearest grapheme boundary. Direction
 *  "down" returns the largest offset <= the input that is a grapheme start;
 *  "up" returns the smallest offset >= the input that is a grapheme end
 *  (i.e. the offset just after the current grapheme). */
export function snapOffsetToGraphemeBoundary(
  value: string,
  offset: number,
  direction: "down" | "up",
): number {
  const total = promptOffsetWidth(value)
  if (offset <= 0) return 0
  if (offset >= total) return total

  let width = 0
  for (const part of graphemes.segment(value)) {
    const segWidth = promptOffsetWidth(part.segment)
    const next = width + segWidth
    if (direction === "down") {
      if (next > offset) return width
      if (next === offset) return offset
    } else {
      if (width >= offset) return width
      if (next >= offset) return next
    }
    width = next
  }
  return total
}

export type RangeReplaceAction =
  | { type: "setCursor"; offset: number }
  | { type: "setSelection"; start: number; end: number }
  | { type: "insertText"; value: string }
  | { type: "clearSelection" }

export interface RangeReplacePlan {
  /** Final text after the plan is applied. */
  readonly text: string
  /** Display-width cursor offset after the plan is applied. */
  readonly cursor: number
  /** Actions to perform on the textarea in order. */
  readonly actions: readonly RangeReplaceAction[]
}

/** Plan a display-width-offset range replace/insert that preserves the
 *  textarea's extmark controller (uses setSelection+insertText+clearSelection
 *  for non-empty ranges, and cursor-set+insertText for pure insertions). */
export function planRangeReplace(
  text: string,
  startOffset: number,
  endOffset: number,
  replacement: string,
): RangeReplacePlan {
  const total = promptOffsetWidth(text)
  const rawStart = Math.max(0, Math.min(startOffset, total))
  const rawEnd = Math.max(0, Math.min(endOffset, total))
  // Treat start>end as an insertion at the (smaller) start — never a delete.
  const isInsertion = rawStart === rawEnd || rawStart > rawEnd
  const insAt = Math.min(rawStart, rawEnd)

  if (isInsertion) {
    const snapped = snapOffsetToGraphemeBoundary(text, insAt, "down")
    const insertWidth = promptOffsetWidth(replacement)
    const newText = displaySlice(text, 0, snapped) + replacement + displaySlice(text, snapped)
    return {
      text: newText,
      cursor: snapped + insertWidth,
      actions: [{ type: "setCursor", offset: snapped }, { type: "insertText", value: replacement }],
    }
  }

  const sStart = Math.min(snapOffsetToGraphemeBoundary(text, rawStart, "down"), rawEnd)
  const sEnd = Math.max(snapOffsetToGraphemeBoundary(text, rawEnd, "up"), sStart)
  const before = displaySlice(text, 0, sStart)
  const after = displaySlice(text, sEnd)
  const insertWidth = promptOffsetWidth(replacement)
  return {
    text: before + replacement + after,
    cursor: sStart + insertWidth,
    actions: [
      { type: "setSelection", start: sStart, end: sEnd },
      { type: "insertText", value: replacement },
      { type: "clearSelection" },
    ],
  }
}

/** Map a logical edit-buffer position to absolute screen coords, accounting
 *  for both axes of viewport scroll. Returns null when the position is
 *  scrolled outside the viewport on either axis. Pure — no native deps. */
export function viewportScreenCoords(
  pos: { row: number; col: number },
  viewport: { offsetX: number; offsetY: number; width: number; height: number },
  screenX: number,
  screenY: number,
): { x: number; y: number } | null {
  const visualRow = pos.row - viewport.offsetY
  const visualCol = pos.col - viewport.offsetX
  if (visualRow < 0 || visualRow >= viewport.height) return null
  if (visualCol < 0 || visualCol >= viewport.width) return null
  return { x: screenX + visualCol, y: screenY + visualRow }
}
