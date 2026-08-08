import {
  diagramBoundsFromBounds,
  diagramBoundsFromPoints,
  segmentBetween,
  segmentSpan,
  translateDiagramBounds,
} from "../core/geometry.js"
import { diagramTextWidth, measureDiagramTextBox, splitDiagramLines } from "../core/text.js"
import {
  flowchartEdgeLabelLayout,
  flowchartHorizontalLabelRankGap,
  flowchartLabelWidth,
  flowchartVerticalBranchLabelGap,
} from "./labels.js"
import type { FlowchartDiagramRenderOptions } from "./options.js"
import { routeFlowchartEdges } from "./routing.js"
import type {
  FlowchartDiagram,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartEdgeRoute,
  FlowchartNode,
  FlowchartNodeBounds,
  FlowchartNodeSize,
  FlowchartSubgraphBounds,
} from "./types.js"

export const DEFAULT_MIN_NODE_GAP = 5
export const DEFAULT_MIN_BRANCH_LABEL_GAP = 12
export const DEFAULT_MIN_RANK_GAP = 10
export const DEFAULT_MIN_VERTICAL_RANK_GAP = 4
export const COMPACT_MIN_RANK_GAP = 4
export const COMPACT_MIN_VERTICAL_RANK_GAP = 2
const SUBGRAPH_PADDING_X = 2
const SUBGRAPH_PADDING_TOP = 1
const SUBGRAPH_PADDING_BOTTOM = 1

export interface FlowchartLayout {
  diagram: FlowchartDiagram
  bounds: Map<string, FlowchartNodeBounds>
  routes: FlowchartEdgeRoute[]
  subgraphBounds: Map<string, FlowchartSubgraphBounds>
  width: number
  height: number
}

type FlowchartBounds = Pick<FlowchartSubgraphBounds, "left" | "top" | "width" | "height" | "centerX" | "centerY">

function horizontalRankGaps(
  diagram: FlowchartDiagram,
  normalizedRanks: ReadonlyMap<string, number>,
  rankKeys: readonly number[],
  fallback: number,
): number[] {
  const gaps = Array.from({ length: Math.max(0, rankKeys.length - 1) }, () => fallback)
  const rankIndexes = new Map(rankKeys.map((rank, index) => [rank, index]))

  for (const edge of diagram.edges) {
    if (!edge.label) continue
    const fromIndex = rankIndexes.get(normalizedRanks.get(edge.from) ?? -1)
    const toIndex = rankIndexes.get(normalizedRanks.get(edge.to) ?? -1)
    if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) continue

    const labelGap = flowchartHorizontalLabelRankGap(flowchartLabelWidth(edge.label, visualLength))
    for (let index = Math.min(fromIndex, toIndex); index < Math.max(fromIndex, toIndex); index++) {
      gaps[index] = Math.max(gaps[index]!, labelGap)
    }
  }

  return gaps
}

function verticalRankGaps(
  diagram: FlowchartDiagram,
  normalizedRanks: ReadonlyMap<string, number>,
  rankKeys: readonly number[],
  fallback: number,
): number[] {
  const gaps = Array.from({ length: Math.max(0, rankKeys.length - 1) }, () => fallback)
  const rankIndexes = new Map(rankKeys.map((rank, index) => [rank, index]))

  for (const edge of diagram.edges) {
    if (!edge.label) continue
    const fromIndex = rankIndexes.get(normalizedRanks.get(edge.from) ?? -1)
    const toIndex = rankIndexes.get(normalizedRanks.get(edge.to) ?? -1)
    if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) continue

    const labelHeight = splitDiagramLines(edge.label).length
    for (let index = Math.min(fromIndex, toIndex); index < Math.max(fromIndex, toIndex); index++) {
      gaps[index] = Math.max(gaps[index]!, labelHeight + 2)
    }
  }

  return gaps
}

function isHorizontalDirection(direction: FlowchartDirection): boolean {
  return direction === "LR" || direction === "RL"
}

export function visualLength(value: string): number {
  return diagramTextWidth(value)
}

export function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}

function nodeSize(node: FlowchartNode): FlowchartNodeSize {
  const { lines, width } = measureDiagramTextBox(node.label, { paddingX: 2 })
  const innerWidth = width - 4
  if (node.shape === "decision") {
    const width = innerWidth + 6
    return {
      width: width % 2 === 0 ? width + 1 : width,
      height: Math.max(5, lines.length + 4),
      lines,
    }
  }
  if (node.shape === "database") return { width: innerWidth + 4, height: lines.length + 4, lines }
  if (node.shape === "subroutine") return { width: innerWidth + 6, height: lines.length + 2, lines }
  return { width: innerWidth + 4, height: lines.length + 2, lines }
}

function rankNodes(diagram: FlowchartDiagram): Map<string, number> {
  const ranks = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  const incoming = new Set<string>()
  const incomingCounts = new Map(diagram.nodes.map((node) => [node.id, 0]))

  const nodeIds = new Set(diagram.nodes.map((node) => node.id))
  const rankEdges = diagram.edges.flatMap((edge) => {
    if (!edge.orderOnly) return [edge]
    const fromIds = nodeIds.has(edge.from) ? [edge.from] : [...collectSubgraphNodeIds(diagram, edge.from)]
    const toIds = nodeIds.has(edge.to) ? [edge.to] : [...collectSubgraphNodeIds(diagram, edge.to)]
    return fromIds.flatMap((from) => toIds.map((to) => ({ ...edge, from, to })))
  })

  for (const edge of rankEdges) {
    const list = outgoing.get(edge.from) ?? []
    list.push(edge.to)
    outgoing.set(edge.from, list)
    incoming.add(edge.to)
    incomingCounts.set(edge.to, (incomingCounts.get(edge.to) ?? 0) + 1)
  }

  const starts = diagram.nodes.filter((node) => !incoming.has(node.id))
  if (starts.length === 0 && diagram.nodes[0]) starts.push(diagram.nodes[0])

  const queue = starts.map((node) => node.id)
  for (const node of starts) ranks.set(node.id, 0)

  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!
    const rank = ranks.get(id) ?? 0
    for (const to of outgoing.get(id) ?? []) {
      const nextRank = rank + 1
      if ((ranks.get(to) ?? Number.POSITIVE_INFINITY) <= nextRank) continue
      ranks.set(to, nextRank)
      queue.push(to)
    }
  }

  for (const node of diagram.nodes) {
    if (!ranks.has(node.id)) ranks.set(node.id, ranks.size)
  }

  const acyclicRanks = new Map<string, number>()
  const acyclicQueue = diagram.nodes.filter((node) => incomingCounts.get(node.id) === 0).map((node) => node.id)
  for (const id of acyclicQueue) acyclicRanks.set(id, 0)
  for (let index = 0; index < acyclicQueue.length; index++) {
    const id = acyclicQueue[index]!
    const rank = acyclicRanks.get(id) ?? 0
    for (const to of outgoing.get(id) ?? []) {
      acyclicRanks.set(to, Math.max(acyclicRanks.get(to) ?? 0, rank + 1))
      const remainingIncoming = (incomingCounts.get(to) ?? 0) - 1
      incomingCounts.set(to, remainingIncoming)
      if (remainingIncoming === 0) acyclicQueue.push(to)
    }
  }
  for (const [id, rank] of acyclicRanks) ranks.set(id, rank)

  return ranks
}

function translateBounds(bounds: FlowchartBounds, dx: number, dy: number): void {
  translateDiagramBounds(bounds, dx, dy)
}

function translateRoutes(routes: readonly FlowchartEdgeRoute[], dx: number, dy: number): void {
  for (const route of routes) {
    for (const point of route.points) {
      point.x += dx
      point.y += dy
    }
  }
}

function boundsFromChildren(children: readonly FlowchartBounds[]): FlowchartBounds | undefined {
  return diagramBoundsFromBounds(children)
}

function subgraphBoundFromChildren(
  id: string,
  label: string,
  children: readonly FlowchartBounds[],
): FlowchartSubgraphBounds {
  const labelLines = splitDiagramLines(label)
  const labelHeight = labelLines.length
  let left = Math.min(...children.map((child) => child.left)) - SUBGRAPH_PADDING_X
  const top = Math.min(...children.map((child) => child.top)) - Math.max(SUBGRAPH_PADDING_TOP, labelHeight)
  let right = Math.max(...children.map((child) => child.left + child.width)) + SUBGRAPH_PADDING_X
  const bottom =
    Math.max(...children.map((child) => child.top + child.height)) + Math.max(SUBGRAPH_PADDING_BOTTOM, labelHeight)
  const minWidth = Math.max(...labelLines.map(visualLength)) + 5

  if (right - left < minWidth) {
    const extra = minWidth - (right - left)
    left -= Math.floor(extra / 2)
    right += Math.ceil(extra / 2)
  }

  const width = right - left
  const height = Math.max(3, bottom - top)
  return {
    id,
    label,
    left,
    top,
    width,
    height,
    centerX: left + Math.floor(width / 2),
    centerY: top + Math.floor(height / 2),
    labelSide: "top",
  }
}

function spansOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd
}

function labelSlot(bounds: FlowchartSubgraphBounds, side: FlowchartSubgraphBounds["labelSide"]): FlowchartBounds {
  const lines = splitDiagramLines(bounds.label)
  const left = bounds.left + 2
  const height = lines.length
  const top = side === "top" ? bounds.top : bounds.top + bounds.height - height
  const width = Math.max(...lines.map((line) => visualLength(` ${line} `)))
  return { left, top, width, height, centerX: left + Math.floor(width / 2), centerY: top + Math.floor(height / 2) }
}

function segmentOverlapsSlot(
  from: { x: number; y: number },
  to: { x: number; y: number },
  slot: FlowchartBounds,
): boolean {
  const segment = segmentBetween(from, to)
  if (!segment) return false

  const slotRight = slot.left + slot.width - 1
  const slotBottom = slot.top + slot.height - 1
  const span = segmentSpan(segment)
  if (segment.axis === "x") {
    return (
      segment.from.y >= slot.top &&
      segment.from.y <= slotBottom &&
      spansOverlap(span.start, span.end, slot.left, slotRight)
    )
  }
  return (
    segment.from.x >= slot.left &&
    segment.from.x <= slotRight &&
    spansOverlap(span.start, span.end, slot.top, slotBottom)
  )
}

function routeOverlapsSlot(route: FlowchartEdgeRoute, slot: FlowchartBounds): boolean {
  for (let index = 1; index < route.points.length; index++) {
    if (segmentOverlapsSlot(route.points[index - 1]!, route.points[index]!, slot)) return true
  }

  const routeLabelBounds = labelBounds(route)
  if (
    !routeLabelBounds ||
    !spansOverlap(
      routeLabelBounds.top,
      routeLabelBounds.top + routeLabelBounds.height - 1,
      slot.top,
      slot.top + slot.height - 1,
    )
  ) {
    return false
  }
  return spansOverlap(
    routeLabelBounds.left,
    routeLabelBounds.left + routeLabelBounds.width - 1,
    slot.left,
    slot.left + slot.width - 1,
  )
}

function chooseSubgraphLabelSide(
  bounds: FlowchartSubgraphBounds,
  routes: readonly FlowchartEdgeRoute[],
): FlowchartSubgraphBounds["labelSide"] {
  const topSlot = labelSlot(bounds, "top")
  if (!routes.some((route) => routeOverlapsSlot(route, topSlot))) return "top"

  const bottomSlot = labelSlot(bounds, "bottom")
  return routes.some((route) => routeOverlapsSlot(route, bottomSlot)) ? "top" : "bottom"
}

function pathBounds(points: readonly { x: number; y: number }[]): FlowchartBounds | undefined {
  return diagramBoundsFromPoints(points)
}

function labelBounds(route: FlowchartEdgeRoute): FlowchartBounds | undefined {
  if (!route.edge.label) return undefined
  const label = flowchartEdgeLabelLayout(route.points, route.edge.label, visualLength)
  const { point, width, height } = label
  return {
    left: point.x,
    top: point.y,
    width,
    height,
    centerX: point.x + Math.floor(width / 2),
    centerY: point.y + Math.floor(height / 2),
  }
}

function subgraphRouteBounds(subgraphNodeIds: Set<string>, routes: readonly FlowchartEdgeRoute[]): FlowchartBounds[] {
  return routeRenderBounds(
    routes.filter((route) => subgraphNodeIds.has(route.edge.from) && subgraphNodeIds.has(route.edge.to)),
  )
}

function routeRenderBounds(routes: readonly FlowchartEdgeRoute[]): FlowchartBounds[] {
  const bounds: FlowchartBounds[] = []
  for (const route of routes) {
    const routeBounds = pathBounds(route.points)
    if (routeBounds) bounds.push(routeBounds)
    const routeLabelBounds = labelBounds(route)
    if (routeLabelBounds) bounds.push(routeLabelBounds)
  }
  return bounds
}

function layoutRankedNodes(
  diagram: FlowchartDiagram,
  direction: FlowchartDirection,
  sizes: ReadonlyMap<string, FlowchartNodeSize>,
  minNodeGap: number,
  requestedMinRankGap: number,
): Map<string, FlowchartNodeBounds> {
  const horizontal = isHorizontalDirection(direction)
  let widestPaddedEdgeLabel = 0
  for (const edge of diagram.edges) {
    if (edge.label)
      widestPaddedEdgeLabel = Math.max(widestPaddedEdgeLabel, flowchartLabelWidth(edge.label, visualLength))
  }
  const rankNodeGap = horizontal
    ? minNodeGap
    : Math.max(minNodeGap, DEFAULT_MIN_BRANCH_LABEL_GAP, flowchartVerticalBranchLabelGap(widestPaddedEdgeLabel))
  const ranks = rankNodes(diagram)
  const maxRank = Math.max(0, ...ranks.values())
  const ranksByIndex = new Map<number, FlowchartNode[]>()
  const normalizedRanks = new Map<string, number>()

  for (const node of diagram.nodes) {
    const rank = ranks.get(node.id) ?? 0
    const normalizedRank = direction === "RL" || direction === "BT" ? maxRank - rank : rank
    normalizedRanks.set(node.id, normalizedRank)
    const nodes = ranksByIndex.get(normalizedRank) ?? []
    nodes.push(node)
    ranksByIndex.set(normalizedRank, nodes)
  }

  const rankKeys = [...ranksByIndex.keys()].sort((a, b) => a - b)
  const horizontalGaps = horizontal ? horizontalRankGaps(diagram, normalizedRanks, rankKeys, requestedMinRankGap) : []
  const verticalGaps = horizontal ? [] : verticalRankGaps(diagram, normalizedRanks, rankKeys, requestedMinRankGap)
  const bounds = new Map<string, FlowchartNodeBounds>()

  if (horizontal) {
    const columnWidths = rankKeys.map((rank) =>
      Math.max(...ranksByIndex.get(rank)!.map((node) => sizes.get(node.id)!.width)),
    )
    const columnHeights = rankKeys.map((rank) => {
      const nodes = ranksByIndex.get(rank)!
      return (
        nodes.reduce((total, node) => total + sizes.get(node.id)!.height, 0) +
        Math.max(0, nodes.length - 1) * rankNodeGap
      )
    })
    const canvasHeight = Math.max(1, ...columnHeights)
    const centerBaseline = Math.floor(canvasHeight / 2)
    let x = 0
    for (let rankIndex = 0; rankIndex < rankKeys.length; rankIndex++) {
      const rank = rankKeys[rankIndex]!
      const nodes = ranksByIndex.get(rank)!
      const columnWidth = columnWidths[rankIndex]!
      let y = centerBaseline - Math.floor(columnHeights[rankIndex]! / 2)
      for (const node of nodes) {
        const size = sizes.get(node.id)!
        const left = x + Math.floor((columnWidth - size.width) / 2)
        bounds.set(node.id, {
          id: node.id,
          ...size,
          left,
          top: y,
          centerX: left + Math.floor(size.width / 2),
          centerY: y + Math.floor(size.height / 2),
        })
        y += size.height + rankNodeGap
      }
      x += columnWidth + (horizontalGaps[rankIndex] ?? 0)
    }
  } else {
    const rowHeights = rankKeys.map((rank) =>
      Math.max(...ranksByIndex.get(rank)!.map((node) => sizes.get(node.id)!.height)),
    )
    const rowWidths = rankKeys.map((rank) => {
      const nodes = ranksByIndex.get(rank)!
      return (
        nodes.reduce((total, node) => total + sizes.get(node.id)!.width, 0) +
        Math.max(0, nodes.length - 1) * rankNodeGap
      )
    })
    const canvasWidth = Math.max(1, ...rowWidths)
    let y = 0
    for (let rankIndex = 0; rankIndex < rankKeys.length; rankIndex++) {
      const rank = rankKeys[rankIndex]!
      const nodes = ranksByIndex.get(rank)!
      const rowHeight = rowHeights[rankIndex]!
      let x = Math.floor((canvasWidth - rowWidths[rankIndex]!) / 2)
      for (const node of nodes) {
        const size = sizes.get(node.id)!
        const top = y + Math.floor((rowHeight - size.height) / 2)
        bounds.set(node.id, {
          id: node.id,
          ...size,
          left: x,
          top,
          centerX: x + Math.floor(size.width / 2),
          centerY: top + Math.floor(size.height / 2),
        })
        x += size.width + rankNodeGap
      }
      y += rowHeight + (verticalGaps[rankIndex] ?? 0)
    }
  }

  return bounds
}

function layoutLocalSubgraphDirections(
  diagram: FlowchartDiagram,
  nodeBounds: Map<string, FlowchartNodeBounds>,
  sizes: ReadonlyMap<string, FlowchartNodeSize>,
  minNodeGap: number,
  requestedMinRankGap: number,
): void {
  for (const subgraph of [...(diagram.subgraphs ?? [])].reverse()) {
    if (!subgraph.direction || subgraph.direction === diagram.direction) continue
    const nodeIds = new Set(subgraph.nodeIds)
    const nodes = diagram.nodes.filter((node) => nodeIds.has(node.id))
    if (nodes.length === 0) continue

    const currentBounds = boundsFromChildren(nodes.flatMap((node) => nodeBounds.get(node.id) ?? []))
    if (!currentBounds) continue

    const localDiagram: FlowchartDiagram = {
      direction: subgraph.direction,
      nodes,
      edges: diagram.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
      subgraphs: [],
    }
    const localNodeGap = isHorizontalDirection(subgraph.direction) ? Math.max(4, minNodeGap - 1) : minNodeGap
    const localBounds = layoutRankedNodes(localDiagram, subgraph.direction, sizes, localNodeGap, requestedMinRankGap)
    const localExtent = boundsFromChildren([...localBounds.values()])
    if (!localExtent) continue

    const targetLeft = currentBounds.left + Math.floor((currentBounds.width - localExtent.width) / 2)
    const targetTop = currentBounds.top + Math.floor((currentBounds.height - localExtent.height) / 2)
    const dx = targetLeft - localExtent.left
    const dy = targetTop - localExtent.top

    for (const [nodeId, bound] of localBounds) {
      translateBounds(bound, dx, dy)
      nodeBounds.set(nodeId, bound)
    }
  }
}

function edgeDirection(diagram: FlowchartDiagram, edge: FlowchartEdge): FlowchartDirection {
  for (const subgraph of [...(diagram.subgraphs ?? [])].reverse()) {
    if (!subgraph.direction) continue
    if (subgraph.nodeIds.includes(edge.from) && subgraph.nodeIds.includes(edge.to)) return subgraph.direction
  }
  return diagram.direction
}

function collectSubgraphNodeIds(diagram: FlowchartDiagram, subgraphId: string): Set<string> {
  const nodeIds = new Set<string>()
  for (const subgraph of diagram.subgraphs ?? []) {
    if (subgraph.id !== subgraphId && subgraph.parentId !== subgraphId) continue
    for (const nodeId of subgraph.nodeIds) nodeIds.add(nodeId)
    if (subgraph.parentId === subgraphId) {
      for (const nodeId of collectSubgraphNodeIds(diagram, subgraph.id)) nodeIds.add(nodeId)
    }
  }
  return nodeIds
}

function separateTopLevelItems(
  diagram: FlowchartDiagram,
  nodeBounds: Map<string, FlowchartNodeBounds>,
  subgraphBounds: ReadonlyMap<string, FlowchartSubgraphBounds>,
  gap: number,
): void {
  const hasLocalDirection = (diagram.subgraphs ?? []).some(
    (subgraph) => subgraph.direction && subgraph.direction !== diagram.direction,
  )
  const coveredNodeIds = new Set<string>()
  const items: { id: string; bounds: FlowchartBounds; nodeIds: Set<string>; rank: number }[] = []
  const itemByEndpoint = new Map<string, string>()
  for (const subgraph of diagram.subgraphs ?? []) {
    if (subgraph.parentId) continue
    const bounds = subgraphBounds.get(subgraph.id)
    const nodeIds = collectSubgraphNodeIds(diagram, subgraph.id)
    if (!bounds || nodeIds.size === 0) continue
    items.push({ id: subgraph.id, bounds, nodeIds, rank: 0 })
    itemByEndpoint.set(subgraph.id, subgraph.id)
    for (const nodeId of nodeIds) {
      coveredNodeIds.add(nodeId)
      itemByEndpoint.set(nodeId, subgraph.id)
    }
  }

  for (const node of diagram.nodes) {
    if (coveredNodeIds.has(node.id)) continue
    const bounds = nodeBounds.get(node.id)
    if (!bounds) continue
    items.push({ id: node.id, bounds, nodeIds: new Set([node.id]), rank: 0 })
    itemByEndpoint.set(node.id, node.id)
  }
  if (items.length < 2) return

  const horizontal = isHorizontalDirection(diagram.direction)
  if (hasLocalDirection) {
    items.sort((a, b) => (horizontal ? a.bounds.left - b.bounds.left : a.bounds.top - b.bounds.top))
    let cursor: number | undefined
    for (const item of items) {
      const start = horizontal ? item.bounds.left : item.bounds.top
      const size = horizontal ? item.bounds.width : item.bounds.height
      if (cursor === undefined) {
        cursor = start + size + gap
        continue
      }
      const shift = cursor - start
      for (const nodeId of item.nodeIds) {
        const bounds = nodeBounds.get(nodeId)
        if (bounds) translateBounds(bounds, horizontal ? shift : 0, horizontal ? 0 : shift)
      }
      cursor = start + shift + size + gap
    }
    return
  }

  const topLevelIds = new Set(
    (diagram.subgraphs ?? []).filter((subgraph) => !subgraph.parentId).map((subgraph) => subgraph.id),
  )
  const rankedItems = items.filter((item) => topLevelIds.has(item.id))
  if (rankedItems.length < 2) return

  const itemById = new Map(rankedItems.map((item) => [item.id, item]))
  const outgoing = new Map(rankedItems.map((item) => [item.id, new Set<string>()]))
  const incoming = new Map(rankedItems.map((item) => [item.id, 0]))
  for (const edge of diagram.edges) {
    const from = itemByEndpoint.get(edge.from)
    const to = itemByEndpoint.get(edge.to)
    if (!from || !to || from === to || !itemById.has(from) || !itemById.has(to) || outgoing.get(from)!.has(to)) continue
    outgoing.get(from)!.add(to)
    incoming.set(to, incoming.get(to)! + 1)
  }

  const queue = rankedItems.filter((item) => incoming.get(item.id) === 0)
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index]!
    for (const to of outgoing.get(item.id)!) {
      const downstream = itemById.get(to)!
      downstream.rank = Math.max(downstream.rank, item.rank + 1)
      incoming.set(to, incoming.get(to)! - 1)
      if (incoming.get(to) === 0) queue.push(downstream)
    }
  }

  const reversed = diagram.direction === "RL" || diagram.direction === "BT"
  const primaryStart = (item: (typeof items)[number]): number => {
    const start = horizontal ? item.bounds.left : item.bounds.top
    const size = horizontal ? item.bounds.width : item.bounds.height
    return reversed ? -(start + size) : start
  }
  rankedItems.sort((a, b) => a.rank - b.rank || primaryStart(a) - primaryStart(b))

  let cursor: number | undefined
  for (const item of rankedItems) {
    const start = primaryStart(item)
    const size = horizontal ? item.bounds.width : item.bounds.height
    if (cursor === undefined) {
      cursor = start + size + gap
      continue
    }
    const shift = Math.max(0, cursor - start)
    if (shift > 0) {
      for (const nodeId of item.nodeIds) {
        const bounds = nodeBounds.get(nodeId)
        if (bounds) {
          const offset = reversed ? -shift : shift
          translateBounds(bounds, horizontal ? offset : 0, horizontal ? 0 : offset)
        }
      }
    }
    cursor = start + shift + size + gap
  }
}

function layoutSubgraphs(
  diagram: FlowchartDiagram,
  nodeBounds: Map<string, FlowchartNodeBounds>,
  routes: readonly FlowchartEdgeRoute[],
): Map<string, FlowchartSubgraphBounds> {
  const subgraphBounds = new Map<string, FlowchartSubgraphBounds>()
  const subgraphs = diagram.subgraphs ?? []

  for (const subgraph of [...subgraphs].reverse()) {
    const children: FlowchartBounds[] = []
    for (const nodeId of subgraph.nodeIds) {
      const bound = nodeBounds.get(nodeId)
      if (bound) children.push(bound)
    }
    children.push(...subgraphRouteBounds(new Set(subgraph.nodeIds), routes))
    for (const childSubgraph of subgraphs) {
      if (childSubgraph.parentId !== subgraph.id) continue
      const bound = subgraphBounds.get(childSubgraph.id)
      if (bound) children.push(bound)
    }
    if (children.length > 0) {
      const bound = subgraphBoundFromChildren(subgraph.id, subgraph.label, children)
      bound.labelSide = chooseSubgraphLabelSide(bound, routes)
      subgraphBounds.set(subgraph.id, bound)
    }
  }

  return subgraphBounds
}

function layoutFlowchartWithDirection(
  sourceDiagram: FlowchartDiagram,
  options: FlowchartDiagramRenderOptions,
  direction: FlowchartDirection,
): FlowchartLayout {
  const diagram = direction === sourceDiagram.direction ? sourceDiagram : { ...sourceDiagram, direction }
  const horizontal = isHorizontalDirection(direction)
  const minNodeGap = normalizePositiveInt(options.minNodeGap, DEFAULT_MIN_NODE_GAP)
  const requestedMinRankGap = normalizePositiveInt(
    options.minRankGap,
    options.compact
      ? horizontal
        ? COMPACT_MIN_RANK_GAP
        : COMPACT_MIN_VERTICAL_RANK_GAP
      : horizontal
        ? DEFAULT_MIN_RANK_GAP
        : DEFAULT_MIN_VERTICAL_RANK_GAP,
  )
  const sizes = new Map(diagram.nodes.map((node) => [node.id, nodeSize(node)]))
  const bounds = layoutRankedNodes(diagram, direction, sizes, minNodeGap, requestedMinRankGap)
  layoutLocalSubgraphDirections(diagram, bounds, sizes, minNodeGap, requestedMinRankGap)

  let routes = routeFlowchartEdges(diagram, bounds, (edge) => edgeDirection(diagram, edge))
  let subgraphBounds = layoutSubgraphs(diagram, bounds, routes)
  separateTopLevelItems(diagram, bounds, subgraphBounds, Math.max(1, Math.floor(requestedMinRankGap / 2)))
  routes = routeFlowchartEdges(diagram, bounds, (edge) => edgeDirection(diagram, edge))
  subgraphBounds = layoutSubgraphs(diagram, bounds, routes)
  routes = routeFlowchartEdges(diagram, bounds, (edge) => edgeDirection(diagram, edge), subgraphBounds)
  subgraphBounds = layoutSubgraphs(diagram, bounds, routes)
  const allBounds = [...bounds.values(), ...subgraphBounds.values(), ...routeRenderBounds(routes)]
  const dx = Math.max(0, -Math.min(0, ...allBounds.map((bound) => bound.left)))
  const dy = Math.max(0, -Math.min(0, ...allBounds.map((bound) => bound.top)))
  if (dx > 0 || dy > 0) {
    for (const bound of allBounds) translateBounds(bound, dx, dy)
    translateRoutes(routes, dx, dy)
  }

  const maxX = Math.max(0, ...allBounds.map((bound) => bound.left + bound.width))
  const maxY = Math.max(0, ...allBounds.map((bound) => bound.top + bound.height))
  return { diagram, bounds, routes, subgraphBounds, width: maxX + 4, height: maxY + 4 }
}

export function layoutFlowchartDiagram(
  sourceDiagram: FlowchartDiagram,
  options: FlowchartDiagramRenderOptions = {},
): FlowchartLayout {
  const direction = options.direction ?? sourceDiagram.direction
  const layout = layoutFlowchartWithDirection(sourceDiagram, options, direction)
  const maxWidth = options.layoutMaxWidth
  if (!isHorizontalDirection(direction) || maxWidth === undefined || !Number.isFinite(maxWidth)) return layout
  if (layout.width <= Math.max(1, Math.trunc(maxWidth))) return layout

  return layoutFlowchartWithDirection(sourceDiagram, options, direction === "RL" ? "BT" : "TD")
}
