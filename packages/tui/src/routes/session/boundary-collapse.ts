import type { AnchorTarget } from "./anchors"
import type { GroupKind } from "./grouping/session"

export type BoundaryCollapseMode = "off" | "overflow" | "always"

export type GroupAnchorBox = {
  target: AnchorTarget
  node: {
    y: number
    height: number
    isDestroyed: boolean
  }
}

export type BoundaryCollapseTarget = {
  groupID: string
  kind: GroupKind
  level: number
  node: GroupAnchorBox["node"]
}

/**
 * Parses a group anchor ID produced by `groupID(node, level)`.
 * Format: JSON.stringify([messageID, partID, kind, level])
 */
export function parseGroupID(id: string): { kind: GroupKind; level: number } | undefined {
  try {
    const parsed: unknown = JSON.parse(id)
    if (!Array.isArray(parsed) || parsed.length !== 4) return undefined
    const kind = parsed[2]
    const level = parsed[3]
    if (
      (kind !== "activity" && kind !== "reasoning" && kind !== "exploration" && kind !== "instructions") ||
      typeof level !== "number"
    ) {
      return undefined
    }
    return { kind, level }
  } catch {
    return undefined
  }
}

/**
 * Finds the expanded group whose body spans the bottom boundary of the transcript viewport
 * (the line where "Jump to latest" sits). Prefers the outermost matching group (lowest level)
 * so collapsing an expanded low-verbosity activity block folds the whole block in one click.
 */
export function findBoundaryCollapseGroup(input: {
  mode: BoundaryCollapseMode
  viewportTop: number
  viewportHeight: number
  anchors: readonly GroupAnchorBox[]
  isExpanded: (groupID: string, kind: GroupKind) => boolean
}): BoundaryCollapseTarget | undefined {
  if (input.mode === "off" || input.viewportHeight <= 0) return undefined
  const bottomEdge = input.viewportTop + input.viewportHeight
  let best: BoundaryCollapseTarget | undefined
  for (const anchor of input.anchors) {
    if (anchor.target.type !== "group") continue
    const node = anchor.node
    if (node.isDestroyed || node.height <= 1) continue
    // Boundary sits inside the group (strictly below its header row, and reaching or crossing the bottom edge).
    const top = node.y
    const bottom = node.y + node.height
    if (!(top < bottomEdge - 1 && bottom >= bottomEdge)) continue
    if (input.mode === "overflow" && top >= input.viewportTop) continue
    const meta = parseGroupID(anchor.target.groupID)
    if (!meta) continue
    if (!input.isExpanded(anchor.target.groupID, meta.kind)) continue
    if (!best || meta.level < best.level || (meta.level === best.level && top < best.node.y)) {
      best = {
        groupID: anchor.target.groupID,
        kind: meta.kind,
        level: meta.level,
        node,
      }
    }
  }
  return best
}
