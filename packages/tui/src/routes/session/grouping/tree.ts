export type EntryNode<Entry> = {
  type: "entry"
  entry: Entry
  size: 1
}

export type GroupNode<Kind extends PropertyKey, Entry> = {
  type: "group"
  kind: Kind
  children: TimelineNode<Kind, Entry>[]
  size: number
}

export type TimelineNode<Kind extends PropertyKey, Entry> = EntryNode<Entry> | GroupNode<Kind, Entry>

export type GroupPath<Kind extends PropertyKey, Entry> = (entry: Entry) => readonly Kind[]

export function groupEntries<Kind extends PropertyKey, Entry>(entries: readonly Entry[], path: GroupPath<Kind, Entry>) {
  return entries.reduce<TimelineNode<Kind, Entry>[]>((nodes, entry) => {
    appendEntry(nodes, entry, path(entry))
    return nodes
  }, [])
}

/** Merge ordered chunks at their shared seam without mutating either input. */
export function mergeGroups<Kind extends PropertyKey, Entry>(
  left: readonly TimelineNode<Kind, Entry>[],
  right: readonly TimelineNode<Kind, Entry>[],
): TimelineNode<Kind, Entry>[] {
  if (left.length === 0) return [...right]
  if (right.length === 0) return [...left]
  const before = left.at(-1)!
  const after = right[0]
  if (before.type !== "group" || after.type !== "group" || before.kind !== after.kind) {
    return [...left, ...right]
  }
  return [
    ...left.slice(0, -1),
    {
      type: "group",
      kind: before.kind,
      children: mergeGroups(before.children, after.children),
      size: before.size + after.size,
    },
    ...right.slice(1),
  ]
}

/** Split at a depth-first leaf offset, preserving the surrounding group paths. */
export function splitGroups<Kind extends PropertyKey, Entry>(
  nodes: readonly TimelineNode<Kind, Entry>[],
  count: number,
): [TimelineNode<Kind, Entry>[], TimelineNode<Kind, Entry>[]] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Group split must be a non-negative integer")
  if (count === 0) return [[], [...nodes]]
  const total = leafCount(nodes)
  if (count > total) throw new RangeError("Group split exceeds leaf count")
  if (count === total) return [[...nodes], []]

  let offset = 0
  for (const [index, node] of nodes.entries()) {
    const end = offset + node.size
    if (count === end) return [[...nodes.slice(0, index + 1)], [...nodes.slice(index + 1)]]
    if (count < end) {
      if (node.type !== "group") throw new RangeError("Cannot split inside a leaf")
      const size = count - offset
      const [left, right] = splitGroups(node.children, size)
      return [
        [...nodes.slice(0, index), { ...node, children: left, size }],
        [{ ...node, children: right, size: node.size - size }, ...nodes.slice(index + 1)],
      ]
    }
    offset = end
  }
  throw new RangeError("Group split exceeds leaf count")
}

export function flattenGroups<Kind extends PropertyKey, Entry>(nodes: readonly TimelineNode<Kind, Entry>[]): Entry[] {
  return nodes.flatMap((node) => (node.type === "entry" ? [node.entry] : flattenGroups(node.children)))
}

export function leafCount<Kind extends PropertyKey, Entry>(nodes: readonly TimelineNode<Kind, Entry>[]) {
  return nodes.reduce((total, node) => total + node.size, 0)
}

function appendEntry<Kind extends PropertyKey, Entry>(
  nodes: TimelineNode<Kind, Entry>[],
  entry: Entry,
  path: readonly Kind[],
  depth = 0,
) {
  const kind = path[depth]
  if (kind === undefined) {
    nodes.push({ type: "entry", entry, size: 1 })
    return
  }
  const previous = nodes.at(-1)
  const group: GroupNode<Kind, Entry> =
    previous?.type === "group" && previous.kind === kind ? previous : { type: "group", kind, children: [], size: 0 }
  if (group !== previous) nodes.push(group)
  group.size++
  appendEntry(group.children, entry, path, depth + 1)
}
