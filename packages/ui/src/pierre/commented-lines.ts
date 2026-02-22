import { type SelectedLineRange } from "@pierre/diffs"

export type CommentSide = "additions" | "deletions"

function annotationIndex(node: HTMLElement) {
  const value = node.dataset.lineAnnotation?.split(",")[1]
  if (!value) return
  const line = parseInt(value, 10)
  if (Number.isNaN(line)) return
  return line
}

function clear(root: ShadowRoot) {
  const marked = Array.from(root.querySelectorAll("[data-comment-selected]"))
  for (const node of marked) {
    if (!(node instanceof HTMLElement)) continue
    node.removeAttribute("data-comment-selected")
  }
}

export function findDiffSide(node: HTMLElement): CommentSide {
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

function lineIndex(split: boolean, node: HTMLElement) {
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

function rowIndex(root: ShadowRoot, split: boolean, line: number, side: CommentSide | undefined) {
  const rows = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-alt-line="${line}"]`)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (rows.length === 0) return

  const target = side ?? "additions"
  for (const row of rows) {
    if (findDiffSide(row) === target) return lineIndex(split, row)
    if (parseInt(row.dataset.altLine ?? "", 10) === line) return lineIndex(split, row)
  }
}

export function markCommentedDiffLines(root: ShadowRoot, ranges: SelectedLineRange[]) {
  clear(root)

  const diffs = root.querySelector("[data-diff]")
  if (!(diffs instanceof HTMLElement)) return

  const split = diffs.dataset.diffType === "split"
  const rows = Array.from(diffs.querySelectorAll("[data-line-index]")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (rows.length === 0) return

  const annotations = Array.from(diffs.querySelectorAll("[data-line-annotation]")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )

  for (const range of ranges) {
    const start = rowIndex(root, split, range.start, range.side)
    if (start === undefined) continue

    const end = (() => {
      const same = range.end === range.start && (range.endSide == null || range.endSide === range.side)
      if (same) return start
      return rowIndex(root, split, range.end, range.endSide ?? range.side)
    })()
    if (end === undefined) continue

    const first = Math.min(start, end)
    const last = Math.max(start, end)

    for (const row of rows) {
      const idx = lineIndex(split, row)
      if (idx === undefined || idx < first || idx > last) continue
      row.setAttribute("data-comment-selected", "")
    }

    for (const annotation of annotations) {
      const idx = annotationIndex(annotation)
      if (idx === undefined || idx < first || idx > last) continue
      annotation.setAttribute("data-comment-selected", "")
    }
  }
}

export function markCommentedFileLines(root: ShadowRoot, ranges: SelectedLineRange[]) {
  clear(root)

  const annotations = Array.from(root.querySelectorAll("[data-line-annotation]")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )

  for (const range of ranges) {
    const start = Math.max(1, Math.min(range.start, range.end))
    const end = Math.max(range.start, range.end)

    for (let line = start; line <= end; line++) {
      const nodes = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-column-number="${line}"]`))
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue
        node.setAttribute("data-comment-selected", "")
      }
    }

    for (const annotation of annotations) {
      const line = annotationIndex(annotation)
      if (line === undefined || line < start || line > end) continue
      annotation.setAttribute("data-comment-selected", "")
    }
  }
}
