export type TreeInput = {
  sessionID: string
  parentID: string | null
  tin: number
  tout: number
  cost: number
  live: boolean
}

export type Rollup = { tin: number; tout: number; cost: number; live: number; descendants: number }

export type TreeNode<T extends TreeInput> = {
  row: T
  depth: number
  hasChildren: boolean
  collapsed: boolean
  rollup: Rollup
}

/**
 * Orders rows parent-first with subagents nested under their orchestrator.
 * A branch is kept when any node in it matches; a match below a collapsed
 * node forces that node open so the match stays visible.
 */
export function buildTree<T extends TreeInput>(
  rows: T[],
  options: { collapsed: Set<string>; match: (row: T) => boolean },
): TreeNode<T>[] {
  const byID = new Map(rows.map((row) => [row.sessionID, row]))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const row of rows) {
    const parent = row.parentID && row.parentID !== row.sessionID ? byID.get(row.parentID) : undefined
    if (!parent || reachesSelf(row, byID)) {
      roots.push(row)
      continue
    }
    const list = children.get(parent.sessionID) ?? []
    list.push(row)
    children.set(parent.sessionID, list)
  }

  const rollups = new Map<string, Rollup>()
  const matched = new Map<string, boolean>()
  const visit = (row: T): void => {
    const rollup: Rollup = { tin: row.tin, tout: row.tout, cost: row.cost, live: row.live ? 1 : 0, descendants: 0 }
    let anyMatch = options.match(row)
    for (const child of children.get(row.sessionID) ?? []) {
      visit(child)
      const sub = rollups.get(child.sessionID)!
      rollup.tin += sub.tin
      rollup.tout += sub.tout
      rollup.cost += sub.cost
      rollup.live += sub.live
      rollup.descendants += sub.descendants + 1
      anyMatch ||= matched.get(child.sessionID)!
    }
    rollups.set(row.sessionID, rollup)
    matched.set(row.sessionID, anyMatch)
  }
  roots.forEach(visit)

  const out: TreeNode<T>[] = []
  const emit = (row: T, depth: number): void => {
    if (!matched.get(row.sessionID)) return
    const kids = (children.get(row.sessionID) ?? []).filter((child) => matched.get(child.sessionID))
    // Emitted but not itself a match: a descendant matched, so force the branch open.
    const collapsed = options.collapsed.has(row.sessionID) && options.match(row)
    out.push({
      row,
      depth,
      hasChildren: (children.get(row.sessionID)?.length ?? 0) > 0,
      collapsed,
      rollup: rollups.get(row.sessionID)!,
    })
    if (collapsed) return
    for (const child of kids) emit(child, depth + 1)
  }
  roots.forEach((root) => emit(root, 0))
  return out
}

function reachesSelf<T extends TreeInput>(row: T, byID: Map<string, T>): boolean {
  const seen = new Set<string>([row.sessionID])
  let cursor = row.parentID ? byID.get(row.parentID) : undefined
  while (cursor) {
    if (seen.has(cursor.sessionID)) return cursor.sessionID === row.sessionID
    seen.add(cursor.sessionID)
    cursor = cursor.parentID ? byID.get(cursor.parentID) : undefined
  }
  return false
}
