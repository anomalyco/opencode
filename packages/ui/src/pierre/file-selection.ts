import { type SelectedLineRange } from "@pierre/diffs"
import { findDiffSide } from "./diff-selection"
import { toRange } from "./selection-bridge"

export type DiffLineSpan = {
  additions: number
  deletions: number
}

export function readDiffLineSpan(node: Node | null): DiffLineSpan | undefined {
  const el = findElement(node)
  if (!el) return

  const row = el.closest("[data-line], [data-alt-line]")
  if (!(row instanceof HTMLElement)) return

  const line = parseInt(row.dataset.line ?? "", 10)
  if (Number.isNaN(line)) return

  const alt = parseInt(row.dataset.altLine ?? "", 10)
  const side = findDiffSide(row)
  const additions = side === "additions" ? line : !Number.isNaN(alt) ? alt : line
  const deletions = side === "deletions" ? line : !Number.isNaN(alt) ? alt : line
  return { additions, deletions }
}

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

export function readShadowLineSelection(opts: {
  root: ShadowRoot
  lineForNode: (node: Node | null) => number | undefined
  sideForNode?: (node: Node | null) => SelectedLineRange["side"]
  preserveTextSelection?: boolean
}) {
  const selection =
    (opts.root as unknown as { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection()
  if (!selection || selection.isCollapsed) return

  const domRange =
    (
      selection as unknown as {
        getComposedRanges?: (options?: { shadowRoots?: ShadowRoot[] }) => StaticRange[]
      }
    ).getComposedRanges?.({ shadowRoots: [opts.root] })?.[0] ??
    (selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined)

  const startNode = domRange?.startContainer ?? selection.anchorNode
  const endNode = domRange?.endContainer ?? selection.focusNode
  if (!startNode || !endNode) return
  if (!opts.root.contains(startNode) || !opts.root.contains(endNode)) return

  const start = opts.lineForNode(startNode)
  const end = opts.lineForNode(endNode)
  if (start === undefined || end === undefined) return

  const startSide = opts.sideForNode?.(startNode)
  const endSide = opts.sideForNode?.(endNode)
  const side = startSide ?? endSide

  const range: SelectedLineRange = { start, end }
  if (side) range.side = side
  if (endSide && side && endSide !== side) {
    range.endSide = endSide
    const a = readDiffLineSpan(startNode)
    const b = readDiffLineSpan(endNode)
    if (a && b) {
      const extra = range as SelectedLineRange & {
        additionStart?: number
        additionEnd?: number
        deletionStart?: number
        deletionEnd?: number
      }
      extra.additionStart = Math.min(a.additions, b.additions)
      extra.additionEnd = Math.max(a.additions, b.additions)
      extra.deletionStart = Math.min(a.deletions, b.deletions)
      extra.deletionEnd = Math.max(a.deletions, b.deletions)
    }
  }

  return {
    range,
    text: opts.preserveTextSelection && domRange ? toRange(domRange).cloneRange() : undefined,
  }
}
