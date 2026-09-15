import { type SelectedLineRange } from "@pierre/diffs"

export type DiffSelectionSide = "additions" | "deletions"

export function findDiffSide(node: HTMLElement): DiffSelectionSide {
  const line = node.closest("[data-line], [data-alt-line]")
  if (line instanceof HTMLElement) {
    const type = line.dataset.lineType
    if (type === "change-deletion") return "deletions"
    if (type === "change-addition" || type === "change-additions") return "additions"
  }

  const code = node.closest("[data-code]")
  if (!(code instanceof HTMLElement)) return "additions"
  return code.hasAttribute("data-deletions") ? "deletions" : "additions"
}

export function diffLineIndex(split: boolean, node: HTMLElement) {
  const raw = node.dataset.lineIndex
  if (!raw) return

  const values = raw
    .split(",")
    .map((x) => parseInt(x, 10))
    .filter((x) => !Number.isNaN(x))
  if (values.length === 0) return
  if (!split) return values[0]
  if (values.length === 2) return values[1]
  return values[0]
}

export function diffRowIndex(root: ShadowRoot, split: boolean, line: number, side: DiffSelectionSide | undefined) {
  const rows = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-alt-line="${line}"]`)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (rows.length === 0) return

  const target = side ?? "additions"
  for (const row of rows) {
    if (findDiffSide(row) === target) return diffLineIndex(split, row)
    if (parseInt(row.dataset.altLine ?? "", 10) === line) return diffLineIndex(split, row)
  }
}

export function fixDiffSelection(root: ShadowRoot | undefined, range: SelectedLineRange | null) {
  if (!range) return range
  if (!root) return

  const diffs = root.querySelector("[data-diff]")
  if (!(diffs instanceof HTMLElement)) return

  const split = diffs.dataset.diffType === "split"
  const start = diffRowIndex(root, split, range.start, range.side)
  const end = diffRowIndex(root, split, range.end, range.endSide ?? range.side)

  if (start === undefined || end === undefined) {
    if (root.querySelector("[data-line], [data-alt-line]") == null) return
    return null
  }
  if (start <= end) return range

  const side = range.endSide ?? range.side
  const swapped: SelectedLineRange = {
    start: range.end,
    end: range.start,
  }

  if (side) swapped.side = side
  if (range.endSide && range.side) swapped.endSide = range.side
  return swapped
}
