import { groupID } from "./anchors"
import type { GroupKind, SessionNode, SessionRow } from "./grouping/session"

/**
 * Transcript mounting is budgeted by rendered entries, not rows. A collapsed group
 * renders one header however many parts it holds; an expanded or ungrouped one
 * renders its children. With every group collapsed each row costs one, which is
 * the former row-count budget.
 */
export function rowWeight(
  row: SessionRow,
  input: { expanded: (groupID: string) => boolean; grouped: (kind: GroupKind) => boolean },
) {
  if (row.type !== "group") return 1
  const visit = (node: Extract<SessionNode, { type: "group" }>, level: number): number => {
    if (!input.grouped(node.kind)) return node.size
    const id = groupID(node, level)
    if (!id || !input.expanded(id)) return 1
    return node.children.reduce((total, child) => total + (child.type === "group" ? visit(child, level + 1) : 1), 1)
  }
  return visit(row, 0)
}

/** First row index such that rows [index, end) spend at least `budget`. */
export function rowsBefore(weights: readonly number[], end: number, budget: number) {
  let index = end
  let spent = 0
  while (index > 0 && spent < budget) spent += weights[--index]
  return index
}

/** End row index such that rows [start, index) spend at least `budget`. */
export function rowsAfter(weights: readonly number[], start: number, budget: number) {
  let index = start
  let spent = 0
  while (index < weights.length && spent < budget) spent += weights[index++]
  return index
}
