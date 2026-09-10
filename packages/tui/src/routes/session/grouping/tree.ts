export type GroupNode<Entry, Kind extends string> =
  | { readonly type: "entry"; readonly entry: Entry; readonly size: 1 }
  | {
      readonly type: "group"
      readonly kind: Kind
      readonly children: readonly GroupNode<Entry, Kind>[]
      /** Number of descendant leaves, independent of disclosure state. */
      readonly size: number
    }

/**
 * Group adjacent entries by their configured nesting paths. For example, a read
 * can use ["exploration"] today or ["activity", "exploration"] in Low.
 * Entries are opaque: message/part identity, visibility and live state remain
 * owned by the session projection. A path of [] creates a standalone leaf.
 */
export function groupEntries<Entry, Kind extends string>(
  entries: readonly Entry[],
  path: (entry: Entry) => readonly Kind[],
): readonly GroupNode<Entry, Kind>[] {
  const result: GroupNode<Entry, Kind>[] = []
  // Only fresh groups are mutable during construction. No input tree is edited.
  const stack: { type: "group"; kind: Kind; children: GroupNode<Entry, Kind>[]; size: number }[] = []
  entries.forEach((entry) => {
    const kinds = path(entry)
    const shared = kinds.findIndex((kind, depth) => stack[depth]?.kind !== kind)
    stack.length = shared === -1 ? kinds.length : shared
    kinds.slice(stack.length).forEach((kind) => {
      const group = { type: "group" as const, kind, children: [] as GroupNode<Entry, Kind>[], size: 0 }
      const children = stack.at(-1)?.children ?? result
      children.push(group)
      stack.push(group)
    })
    stack.forEach((group) => group.size++)
    const children = stack.at(-1)?.children ?? result
    children.push({ type: "entry", entry, size: 1 })
  })
  return result
}

/**
 * Concatenate ordered, disjoint chunks, recursively merging compatible groups
 * at their seam. Untouched subtrees retain their object identity.
 *
 * This is concatenation, not ingestion: callers must reconcile overlapping
 * pages/replayed message IDs before merging. Equal payloads may be distinct
 * entries and must not be silently deduplicated here.
 */
export function mergeGroups<Entry, Kind extends string>(
  left: readonly GroupNode<Entry, Kind>[],
  right: readonly GroupNode<Entry, Kind>[],
): readonly GroupNode<Entry, Kind>[] {
  if (!left.length) return right
  if (!right.length) return left
  const a = left[left.length - 1]
  const b = right[0]
  if (a.type !== "group" || b.type !== "group" || a.kind !== b.kind) return [...left, ...right]
  return [
    ...left.slice(0, -1),
    {
      type: "group",
      kind: a.kind,
      size: a.size + b.size,
      children: mergeGroups(a.children, b.children),
    },
    ...right.slice(1),
  ]
}

/**
 * Split at a depth-first leaf offset. Group headers count as zero. Cached sizes
 * skip whole subtrees; only the ancestors crossing the cut are reconstructed.
 * The returned halves can be seam-merged again without changing their meaning.
 */
export function splitGroups<Entry, Kind extends string>(
  nodes: readonly GroupNode<Entry, Kind>[],
  count: number,
): readonly [readonly GroupNode<Entry, Kind>[], readonly GroupNode<Entry, Kind>[]] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Group split requires a non-negative integer")
  if (count === 0) return [[], nodes]
  let offset = 0
  for (const [index, node] of nodes.entries()) {
    const end = offset + node.size
    if (count === end) return [nodes.slice(0, index + 1), nodes.slice(index + 1)]
    if (count < end) {
      if (node.type !== "group") throw new RangeError("Cannot split inside an entry")
      const size = count - offset
      const [left, right] = splitGroups(node.children, size)
      return [
        [...nodes.slice(0, index), { ...node, children: left, size }],
        [{ ...node, children: right, size: node.size - size }, ...nodes.slice(index + 1)],
      ]
    }
    offset = end
  }
  throw new RangeError("Group split exceeds entry count")
}
