import { type SelectedLineRange } from "@pierre/diffs"
import { toRange } from "./selection-bridge"

export function findElement(node: Node | null): HTMLElement | undefined {
  if (!node) return

  if (node instanceof HTMLElement) return node

  return node.parentElement ?? undefined
}

export function findFileLineNumber(node: Node | null): number | undefined {
  const el = findElement(node)

  if (!el) return

  const line = el.closest("[data-line]")

  if (!(line instanceof HTMLElement)) return

  const value = parseInt(line.dataset.line ?? "", 10)

  if (Number.isNaN(value)) return

  return value
}

export function findDiffLineNumber(node: Node | null): number | undefined {
  const el = findElement(node)

  if (!el) return

  const line = el.closest("[data-line], [data-alt-line]")

  if (!(line instanceof HTMLElement)) return

  const primary = parseInt(line.dataset.line ?? "", 10)

  if (!Number.isNaN(primary)) return primary

  const alt = parseInt(line.dataset.altLine ?? "", 10)

  if (!Number.isNaN(alt)) return alt
}

export function findCodeSelectionSide(node: Node | null): SelectedLineRange["side"] {
  const el = findElement(node)

  if (!el) return

  const code = el.closest("[data-code]")

  if (!(code instanceof HTMLElement)) return

  if (code.hasAttribute("data-deletions")) return "deletions"

  return "additions"
}

type ComposedSelection = {
  getComposedRanges?: (options?: { shadowRoots?: ShadowRoot[] }) => StaticRange[]
  direction?: string
}

/** The lines under the browser's text selection in a viewer's shadow root, with the selected text's DOM range. */
export function readShadowLineSelection(opts: {
  root: ShadowRoot
  lineForNode: (node: Node | null) => number | undefined
  sideForNode?: (node: Node | null) => SelectedLineRange["side"]
}) {
  // Chromium exposes `getSelection` on shadow roots and `getComposedRanges` on selections; the DOM types do not list them.
  const root: ShadowRoot & { getSelection?: () => Selection | null } = opts.root
  const selection: (Selection & ComposedSelection) | null = root.getSelection?.() ?? window.getSelection()

  if (!selection || selection.isCollapsed) return

  const domRange =
    selection.getComposedRanges?.({ shadowRoots: [opts.root] })?.[0] ??
    (selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined)

  if (!domRange) return

  if (!opts.root.contains(domRange.startContainer) || !opts.root.contains(domRange.endContainer)) return

  // A triple click, or a drag that stops at the start of the next line, ends on a line with nothing selected in it.
  const startLine = selectedLine(domRange.startContainer, domRange.startOffset, false)
  const endLine = selectedLine(domRange.endContainer, domRange.endOffset, true)
  const span = startLine?.row !== endLine?.row
  const startNode = (span && startLine?.empty) || domRange.startContainer
  const endNode = (span && endLine?.empty) || domRange.endContainer

  const start = opts.lineForNode(startNode)
  const end = opts.lineForNode(endNode)

  if (start === undefined || end === undefined) return

  const startSide = opts.sideForNode?.(startNode)
  const endSide = opts.sideForNode?.(endNode)
  const side = startSide ?? endSide

  const range: SelectedLineRange = { start, end }

  if (side) range.side = side

  if (endSide && side && endSide !== side) range.endSide = endSide

  return {
    range,
    text: toRange(domRange),
    backward: selection.direction === "backward",
  }
}

/**
 * The line row holding one end of a selection. `empty` is the neighbouring row to read instead when no character of
 * this row is selected: the previous row for the end, the next one for the start.
 */
function selectedLine(node: Node, offset: number, end: boolean) {
  const row = findElement(node)?.closest("[data-line], [data-alt-line]")

  if (!row) return
  const part = new Range()

  if (end) {
    part.setStart(row, 0)
    part.setEnd(node, offset)
  } else {
    part.setStart(node, offset)
    part.setEnd(row, row.childNodes.length)
  }

  if (part.toString() !== "") return { row }

  let next = end ? row.previousElementSibling : row.nextElementSibling

  while (next && !next.matches("[data-line], [data-alt-line]"))
    next = end ? next.previousElementSibling : next.nextElementSibling

  return { row, empty: next ?? undefined }
}
