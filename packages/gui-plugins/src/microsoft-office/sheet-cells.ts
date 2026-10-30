import type { XlsxAnchor } from "@betteroffice/xlsx"
import { selectionAt, type CellAddr, type CellRange, type Selection } from "@betteroffice/xlsx/headless"

/** The sheet's last cell, zero-based: row 1,048,576 in column XFD. */
export const lastCell = { row: 1048575, col: 16383 }

/** A column's letters, such as "A", "Z" or "AA". */
export function columnName(index: number): string {
  return (index < 26 ? "" : columnName(Math.floor(index / 26) - 1)) + String.fromCharCode(65 + (index % 26))
}

/** The cells an export anchor names: one range for a cell or range anchor, none for any other kind. */
export function anchorRange(anchor: XlsxAnchor): CellRange[] {
  if (anchor.kind !== "cell" && anchor.kind !== "range") return []

  const range = parseRange(anchor.a1)

  return range ? [range] : []
}

/** An A1 cell or range, such as "B2" or "A1:F20"; undefined for anything else. */
export function parseRange(a1: string): CellRange | undefined {
  // A lone cell is its own last corner; an empty one, as in "A1:", names no range.
  const corners = a1.split(":")
  const first = parseCell(corners[0] ?? "")
  const last = corners.length === 1 ? first : parseCell(corners[1] ?? "")

  if (!first || !last) return undefined

  return {
    top: Math.min(first.row, last.row),
    left: Math.min(first.col, last.col),
    bottom: Math.max(first.row, last.row),
    right: Math.max(first.col, last.col),
  }
}

/** Grows a range until it covers every merged cell it touches, as Excel selects. */
export function coverMerges(range: CellRange, merges: readonly CellRange[]): CellRange {
  const grown = merges.reduce(
    (current, merge) =>
      overlaps(current, merge)
        ? {
            top: Math.min(current.top, merge.top),
            left: Math.min(current.left, merge.left),
            bottom: Math.max(current.bottom, merge.bottom),
            right: Math.max(current.right, merge.right),
          }
        : current,
    range,
  )

  // A merge the range grew into can touch another one it did not reach before.
  if (same(grown, range)) return grown

  return coverMerges(grown, merges)
}

/**
 * Moves a collapsed selection the way Excel moves its active cell around merged cells: landing in one selects its
 * first cell, and a step that stays inside the merged cell it started from steps past it.
 */
export function settleMerges(previous: Selection, next: Selection, merges: readonly CellRange[]): Selection {
  if (!collapsed(next)) return next

  const merge = merges.find((candidate) => contains(candidate, next.focus))

  if (!merge) return next

  if (!collapsed(previous) || !contains(merge, previous.focus)) return selectionAt({ row: merge.top, col: merge.left })

  const cell = {
    row: Math.min(lastCell.row, Math.max(0, past(previous.focus.row, next.focus.row, merge.top, merge.bottom))),
    col: Math.min(lastCell.col, Math.max(0, past(previous.focus.col, next.focus.col, merge.left, merge.right))),
  }

  const landed = merges.find((candidate) => contains(candidate, cell))

  return selectionAt(landed ? { row: landed.top, col: landed.left } : cell)
}

/** A run of hidden rows or columns, zero-based and inclusive. */
export type Span = { readonly start: number; readonly end: number }

/** Hidden row spans such as "5:7", or column spans such as "C:D", as the export lists them. */
export function parseSpans(spans: readonly string[], axis: "rows" | "columns"): Span[] {
  return spans.flatMap((span) => {
    const [first = "", last = first] = span.split(":")
    const start = axis === "rows" ? Number(first) - 1 : columnIndex(first)
    const end = axis === "rows" ? Number(last) - 1 : columnIndex(last)

    return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start ? [{ start, end }] : []
  })
}

/**
 * Moves a selection's focus off hidden rows and columns, on in the direction it moved, as Excel's arrow keys skip
 * them. A move that would leave the sheet stays where it started.
 */
export function skipHidden(
  from: CellAddr,
  selection: Selection,
  hidden: { readonly rows: readonly Span[]; readonly columns: readonly Span[] },
): Selection {
  const focus = {
    row: clear(from.row, selection.focus.row, hidden.rows, lastCell.row),
    col: clear(from.col, selection.focus.col, hidden.columns, lastCell.col),
  }

  if (focus.row === selection.focus.row && focus.col === selection.focus.col) return selection

  if (collapsed(selection)) return selectionAt(focus)

  return { anchor: selection.anchor, focus }
}

/** Whether a row or column lies in one of the hidden spans. */
export function hiddenAt(spans: readonly Span[], index: number) {
  return spans.some((span) => index >= span.start && index <= span.end)
}

/** Runs an engine call that throws on input it cannot take, such as a viewport with too many cells to draw. */
export function attempt<T>(run: () => T): T | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

/** Whether a range holds a cell. */
export function contains(range: CellRange, cell: CellAddr) {
  return cell.row >= range.top && cell.row <= range.bottom && cell.col >= range.left && cell.col <= range.right
}

function parseCell(a1: string): CellAddr | undefined {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(a1)

  if (!match) return undefined

  const col = columnIndex(match[1])
  const row = Number(match[2]) - 1

  if (col > lastCell.col || row > lastCell.row) return undefined

  return { row, col }
}

/** A column's zero-based index from its letters; NaN for anything but one to three letters. */
function columnIndex(letters: string) {
  if (!/^[A-Z]{1,3}$/i.test(letters)) return Number.NaN

  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

/** Where a move along one axis lands once past any hidden span it ended in. */
function clear(from: number, to: number, spans: readonly Span[], last: number): number {
  const span = spans.find((candidate) => to >= candidate.start && to <= candidate.end)

  if (!span || to === from) return to

  const next = to > from ? span.end + 1 : span.start - 1

  if (next < 0 || next > last) return from

  return clear(from, next, spans, last)
}

/** One step along an axis: past the merge's far edge in the direction of the move, or where it was. */
function past(from: number, to: number, low: number, high: number) {
  if (to > from) return high + 1

  if (to < from) return low - 1

  return from
}

function collapsed(selection: Selection) {
  return selection.anchor.row === selection.focus.row && selection.anchor.col === selection.focus.col
}

function overlaps(a: CellRange, b: CellRange) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function same(a: CellRange, b: CellRange) {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right
}
