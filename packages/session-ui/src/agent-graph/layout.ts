import type { AgentGraph, AgentGraphNode, TunnelMessageKind } from "./model"

export type NodeLayout = {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** BFS depth from the family root. */
  depth: number
}

export type SpawnEdgeLayout = {
  type: "spawn"
  from: string
  to: string
  /** Orthogonal polyline from the parent's bottom center to the child's top center. */
  path: string
}

export type MessageEdgeLayout = {
  type: "message"
  from: string
  to: string
  kind: TunnelMessageKind
  /** Tunnel messages the arc aggregates, for labels and selection. */
  count: number
  /** Quadratic bezier arc between the node borders, bowed off the straight path. */
  path: string
}

export type AgentGraphEdgeLayout = SpawnEdgeLayout | MessageEdgeLayout

export type AgentGraphLayout = {
  nodes: NodeLayout[]
  edges: AgentGraphEdgeLayout[]
  width: number
  height: number
}

export type AgentGraphLayoutOptions = {
  nodeWidth?: number
  nodeHeight?: number
  /** Vertical distance between layers. */
  layerGap?: number
  /** Horizontal distance between adjacent sibling slots. */
  siblingGap?: number
  /** Bow of a message arc; parallel arcs between the same pair stack multiples of it. */
  arcOffset?: number
  /** Space around the outermost nodes. */
  padding?: number
}

type NodeSize = Required<AgentGraphLayoutOptions>

export function agentGraphLayout(graph: AgentGraph, options: AgentGraphLayoutOptions = {}): AgentGraphLayout {
  const size: NodeSize = {
    nodeWidth: options.nodeWidth ?? 200,
    nodeHeight: options.nodeHeight ?? 64,
    layerGap: options.layerGap ?? 64,
    siblingGap: options.siblingGap ?? 24,
    arcOffset: options.arcOffset ?? 36,
    padding: options.padding ?? 16,
  }

  if (graph.nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const positions = placeNodes(graph.nodes, size)
  const nodes = graph.nodes.flatMap((node) => {
    const position = positions.get(node.id)

    return position ? [position] : []
  })
  const edges = graph.edges.flatMap((edge): AgentGraphEdgeLayout[] => {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)

    if (!from || !to) return []

    if (edge.type === "spawn") return [{ type: "spawn", from: edge.from, to: edge.to, path: spawnPath(from, to) }]

    return [
      { type: "message", from: edge.from, to: edge.to, kind: edge.kind, count: edge.count, path: messagePath(from, to, size) },
    ]
  })

  // Parallel arcs between the same pair bow apart by index so their kinds stay distinguishable.
  const arcsOf = new Map<string, number>()

  for (const edge of edges) {
    if (edge.type !== "message") continue
    const key = `${edge.from} ${edge.to}`
    const index = arcsOf.get(key) ?? 0

    arcsOf.set(key, index + 1)
    if (index === 0) continue

    const from = positions.get(edge.from)
    const to = positions.get(edge.to)

    if (from && to) edge.path = messagePath(from, to, { ...size, arcOffset: size.arcOffset * (index + 1) })
  }

  const bottom = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0)
  const right = nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0)

  return { nodes, edges, width: right + size.padding, height: bottom + size.padding }
}

/** Positions each node at its layer's depth, centered over its children, leaves in traversal order. */
function placeNodes(graphNodes: readonly AgentGraphNode[], size: NodeSize) {
  const byID = new Map(graphNodes.map((node) => [node.id, node]))
  const children = graphNodes.reduce((acc, node) => {
    if (!node.parentID || !byID.has(node.parentID)) return acc
    const list = acc.get(node.parentID)

    if (list) list.push(node.id)
    else acc.set(node.parentID, [node.id])

    return acc
  }, new Map<string, string[]>())

  // The queue grows while it is iterated: roots first, then their descendants in BFS order.
  const depths = new Map<string, number>()
  const roots = graphNodes.filter((node) => node.parentID === undefined || !byID.has(node.parentID))
  const seeds = roots.length === 0 ? [graphNodes[0].id] : roots.map((node) => node.id)
  const queue = [...seeds]

  for (const root of seeds) depths.set(root, 0)

  for (const parent of queue) {
    for (const child of children.get(parent) ?? []) {
      if (depths.has(child)) continue
      depths.set(child, (depths.get(parent) ?? 0) + 1)
      queue.push(child)
    }
  }

  const slots = new Map<string, number>()
  const visiting = new Set<string>()
  let nextSlot = 0

  // Post-order: leaves take the next free slot, a parent centers over its outermost children, and
  // the slot cursor only moves forward so same-layer nodes stay at least one slot apart. `visiting`
  // cuts a malformed parent cycle before it recurses back onto itself.
  const place = (id: string) => {
    if (slots.has(id) || visiting.has(id)) return
    const kids = children.get(id) ?? []

    if (kids.length === 0) {
      slots.set(id, nextSlot++)
      return
    }

    visiting.add(id)

    for (const kid of kids) place(kid)

    const first = slots.get(kids[0])
    const last = slots.get(kids[kids.length - 1])

    if (first === undefined || last === undefined) {
      slots.set(id, nextSlot++)
      return
    }

    slots.set(id, (first + last) / 2)
  }

  for (const root of seeds) place(root)
  // Nodes a malformed parent cycle hides from the walk still need a slot to be placed at all.
  for (const node of graphNodes) if (!slots.has(node.id)) slots.set(node.id, nextSlot++)

  const slotStep = size.nodeWidth + size.siblingGap
  const layerStep = size.nodeHeight + size.layerGap

  return new Map(
    graphNodes.map((node): [string, NodeLayout] => {
      const slot = slots.get(node.id) ?? 0
      const depth = depths.get(node.id) ?? 0

      return [
        node.id,
        {
          id: node.id,
          x: size.padding + slot * slotStep,
          y: size.padding + depth * layerStep,
          width: size.nodeWidth,
          height: size.nodeHeight,
          depth,
        },
      ]
    }),
  )
}

function spawnPath(from: NodeLayout, to: NodeLayout) {
  const x1 = round(from.x + from.width / 2)
  const y1 = round(from.y + from.height)
  const x2 = round(to.x + to.width / 2)
  const y2 = round(to.y)
  // Bend once, in the gap between the layers.
  const my = round((y1 + y2) / 2)

  return `M ${x1},${y1} L ${x1},${my} L ${x2},${my} L ${x2},${y2}`
}

function messagePath(from: NodeLayout, to: NodeLayout, size: NodeSize) {
  const start = borderPoint(from, to)
  const end = borderPoint(to, from)
  const mx = (start.x + end.x) / 2
  const my = (start.y + end.y) / 2
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  // Left of the travel direction, so arcs of a directed pair all bow the same way.
  const cx = mx - (dy / length) * size.arcOffset
  const cy = my + (dx / length) * size.arcOffset

  return `M ${round(start.x)},${round(start.y)} Q ${round(cx)},${round(cy)} ${round(end.x)},${round(end.y)}`
}

/** Where the line to the other node leaves this node's rectangle. */
function borderPoint(node: NodeLayout, other: NodeLayout) {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const dx = other.x + other.width / 2 - cx
  const dy = other.y + other.height / 2 - cy
  const tx = dx === 0 ? Infinity : node.width / 2 / Math.abs(dx)
  const ty = dy === 0 ? Infinity : node.height / 2 / Math.abs(dy)
  const t = Math.min(tx, ty)

  return { x: cx + dx * t, y: cy + dy * t }
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
