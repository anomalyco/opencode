import {
  advanceCoordinate,
  afterFarthestCoordinate,
  beforeNearestCoordinate,
  boundsCenter,
  boundsSidePoint,
  centerCoordinate,
  coordinate,
  keepAfter,
  keepBefore,
  lane,
  oppositeSide,
  orthogonalPath,
  pathThrough,
  pathViaLane,
  segmentBetween,
  sideForDirection,
  snapCoordinate,
  shiftPoint,
  withCoordinate,
  type DiagramAxis,
  type DiagramDirection,
  type DiagramLane,
  type DiagramSide,
} from "../core/geometry.js"
import { diagramTextWidth, splitDiagramLines } from "../core/text.js"
import { flowchartEdgeLabelLayout, flowchartRouteLabelLayout, type FlowchartEdgeLabelLayout } from "./labels.js"
import type {
  FlowchartDiagram,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartEdgeRoute,
  FlowchartNodeBounds,
  FlowchartPoint,
  FlowchartSubgraph,
  FlowchartSubgraphBounds,
} from "./types.js"

export { directionBetween as flowchartDirectionBetween } from "../core/geometry.js"

const BUS_CLEARANCE = 3
const NODE_CLEARANCE = 2
const ROUTING_CANDIDATE_BUDGET = 1024
type HorizontalTravel = Extract<DiagramDirection, "left" | "right">
type VerticalTravel = Extract<DiagramDirection, "up" | "down">
type PortRole = "source" | "target"

interface EdgeRecord {
  edge: FlowchartEdge
  sourcePort: FlowchartPoint
  targetPort: FlowchartPoint
}

function isVerticalDirection(direction: FlowchartDirection): boolean {
  return direction === "TB" || direction === "TD" || direction === "BT"
}

function verticalTravel(from: FlowchartNodeBounds, to: FlowchartNodeBounds): VerticalTravel {
  return centerCoordinate(to, "y") >= centerCoordinate(from, "y") ? "down" : "up"
}

function isVerticalBackEdge(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): boolean {
  return direction === "BT"
    ? centerCoordinate(to, "y") > centerCoordinate(from, "y")
    : centerCoordinate(to, "y") < centerCoordinate(from, "y")
}

function isHorizontalBackEdge(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): boolean {
  return direction === "RL"
    ? centerCoordinate(to, "x") > centerCoordinate(from, "x")
    : centerCoordinate(to, "x") < centerCoordinate(from, "x")
}

function horizontalTravel(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): HorizontalTravel {
  const targetIsRight = centerCoordinate(to, "x") > centerCoordinate(from, "x")
  const targetIsSameOrRight = centerCoordinate(to, "x") >= centerCoordinate(from, "x")
  return direction === "RL" ? (targetIsRight ? "right" : "left") : targetIsSameOrRight ? "right" : "left"
}

function verticalBackEdgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  leftBoundary?: number,
): FlowchartPoint[] {
  const start = boundsSidePoint(from, "left")
  const end = boundsSidePoint(to, "left")
  const busX = Math.min(
    afterFarthestCoordinate([start, end], "x", "left", BUS_CLEARANCE),
    leftBoundary === undefined ? Number.POSITIVE_INFINITY : leftBoundary - BUS_CLEARANCE * 2,
  )
  return pathViaLane(start, lane("x", busX), end)
}

function verticalForwardEdgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds): FlowchartPoint[] {
  const travel = verticalTravel(from, to)
  const startSide = sideForDirection(travel)
  const endSide = oppositeSide(startSide)
  const sourceCenter = boundsCenter(from)
  const targetCenter = boundsCenter(to)
  const start = withCoordinate(boundsSidePoint(from, startSide), "x", snapCoordinate(sourceCenter.x, targetCenter.x, 1))
  const end = boundsSidePoint(to, endSide)
  return orthogonalPath(start, end, { preferredAxis: "y" })
}

function horizontalBackEdgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds): FlowchartPoint[] {
  const start = boundsSidePoint(from, "top")
  const end = boundsSidePoint(to, "top")
  const busY = afterFarthestCoordinate([start, end], "y", "up", BUS_CLEARANCE)
  return pathViaLane(start, lane("y", busY), end)
}

function horizontalEdgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): FlowchartPoint[] {
  const overlapsHorizontally = from.left < to.left + to.width && to.left < from.left + from.width
  if (overlapsHorizontally) return verticalForwardEdgePath(from, to)

  if (isHorizontalBackEdge(from, to, direction)) return horizontalBackEdgePath(from, to)

  const travel = horizontalTravel(from, to, direction)
  const startSide = sideForDirection(travel)
  return orthogonalPath(boundsSidePoint(from, startSide), boundsSidePoint(to, oppositeSide(startSide)), {
    preferredAxis: "x",
  })
}

function selfEdgePath(bounds: FlowchartNodeBounds): FlowchartPoint[] {
  const start = boundsSidePoint(bounds, "right")
  const end = boundsSidePoint(bounds, "bottom")
  const rightLaneX = bounds.left + bounds.width + BUS_CLEARANCE
  const bottomLaneY = bounds.top + bounds.height + 1
  return [start, { x: rightLaneX, y: start.y }, { x: rightLaneX, y: bottomLaneY }, { x: end.x, y: bottomLaneY }, end]
}

function parallelEdgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  axis: DiagramAxis,
  laneCoordinate: number,
): FlowchartPoint[] {
  if (axis === "y") {
    const start = boundsSidePoint(from, "bottom")
    const end = boundsSidePoint(to, "bottom")
    return pathViaLane(start, lane("y", laneCoordinate), end)
  }

  const start = boundsSidePoint(from, "right")
  const end = boundsSidePoint(to, "right")
  return pathViaLane(start, lane("x", laneCoordinate), end)
}

function labelHeight(edge: FlowchartEdge): number {
  return edge.label ? splitDiagramLines(edge.label).length : 0
}

function rightRenderExtent(route: FlowchartEdgeRoute): number {
  let right = Math.max(...route.points.map((point) => point.x))
  if (route.edge.label) {
    const label = flowchartRouteLabelLayout(route, diagramTextWidth)
    right = Math.max(right, label.point.x + label.width - 1)
  }
  return right
}

function parallelLaneAxis(from: FlowchartNodeBounds, to: FlowchartNodeBounds): DiagramAxis {
  return Math.abs(to.centerX - from.centerX) >= Math.abs(to.centerY - from.centerY) ? "y" : "x"
}

function edgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
  leftBoundary?: number,
): FlowchartPoint[] {
  if (from.id === to.id) return selfEdgePath(from)
  if (!isVerticalDirection(direction)) return horizontalEdgePath(from, to, direction)
  const overlapsVertically = from.top < to.top + to.height && to.top < from.top + from.height
  if (overlapsVertically) {
    const travel: HorizontalTravel = centerCoordinate(to, "x") >= centerCoordinate(from, "x") ? "right" : "left"
    return orthogonalPath(
      boundsSidePoint(from, sideForDirection(travel)),
      boundsSidePoint(to, oppositeSide(sideForDirection(travel))),
    )
  }
  return isVerticalBackEdge(from, to, direction)
    ? verticalBackEdgePath(from, to, leftBoundary)
    : verticalForwardEdgePath(from, to)
}

function sourceFanOutLane(
  sourcePort: FlowchartPoint,
  targetPorts: readonly FlowchartPoint[],
  axis: DiagramAxis,
  travel: DiagramDirection,
): number {
  const sourceCoordinate = coordinate(sourcePort, axis)
  const unclamped = keepBefore(
    advanceCoordinate(coordinate(sourcePort, axis), travel, BUS_CLEARANCE),
    beforeNearestCoordinate(targetPorts, axis, travel, NODE_CLEARANCE),
    travel,
  )
  return keepAfter(unclamped, sourceCoordinate, travel)
}

function reserveFanOutLane(
  sourcePort: FlowchartPoint,
  targetPorts: readonly FlowchartPoint[],
  axis: DiagramAxis,
  travel: DiagramDirection,
  reserved: Set<number>,
): number {
  const preferred = sourceFanOutLane(sourcePort, targetPorts, axis, travel)
  const boundary = beforeNearestCoordinate(targetPorts, axis, travel, NODE_CLEARANCE)
  const source = coordinate(sourcePort, axis)
  const available = (() => {
    let checked = 0
    for (let offset = 0; offset <= Math.abs(boundary - preferred) && checked < ROUTING_CANDIDATE_BUDGET; offset++) {
      checked++
      const candidate = advanceCoordinate(preferred, travel, offset)
      if (
        keepBefore(candidate, boundary, travel) === candidate &&
        keepAfter(candidate, source, travel) === candidate &&
        !reserved.has(candidate)
      ) {
        return candidate
      }
    }
    for (let offset = 1; offset <= Math.abs(preferred - source) && checked < ROUTING_CANDIDATE_BUDGET; offset++) {
      checked++
      const candidate = advanceCoordinate(preferred, travel, -offset)
      if (
        keepBefore(candidate, boundary, travel) === candidate &&
        keepAfter(candidate, source, travel) === candidate &&
        !reserved.has(candidate)
      ) {
        return candidate
      }
    }
  })()
  const routeLane = available ?? preferred
  reserved.add(routeLane)
  return routeLane
}

function targetFanInLane(
  sourcePorts: readonly FlowchartPoint[],
  targetPort: FlowchartPoint,
  axis: DiagramAxis,
  travel: DiagramDirection,
): number {
  const targetCoordinate = coordinate(targetPort, axis)
  const unclamped = keepAfter(
    advanceCoordinate(coordinate(targetPort, axis), travel, -BUS_CLEARANCE),
    afterFarthestCoordinate(sourcePorts, axis, travel, NODE_CLEARANCE),
    travel,
  )
  return keepBefore(unclamped, advanceCoordinate(targetCoordinate, travel, -1), travel)
}

function portForTravel(bounds: FlowchartNodeBounds, travel: DiagramDirection, role: PortRole): FlowchartPoint {
  const side = role === "source" ? sideForDirection(travel) : oppositeSide(sideForDirection(travel))
  return boundsSidePoint(bounds, side)
}

function horizontalForwardRecords(
  edges: FlowchartEdge[],
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
): EdgeRecord[] {
  const travel = direction === "RL" ? "left" : "right"
  const records: EdgeRecord[] = []
  for (const edge of edges) {
    const source = bounds.get(edge.from)
    const target = bounds.get(edge.to)
    if (!source || !target) continue
    const forward =
      direction === "RL"
        ? centerCoordinate(target, "x") < centerCoordinate(source, "x")
        : centerCoordinate(target, "x") > centerCoordinate(source, "x")
    if (!forward) continue
    records.push({
      edge,
      sourcePort: portForTravel(source, travel, "source"),
      targetPort: portForTravel(target, travel, "target"),
    })
  }
  return records
}

function verticalForwardRecords(
  edges: FlowchartEdge[],
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
): EdgeRecord[] {
  const travel = direction === "BT" ? "up" : "down"
  const records: EdgeRecord[] = []
  for (const edge of edges) {
    const source = bounds.get(edge.from)
    const target = bounds.get(edge.to)
    if (!source || !target) continue
    const forward =
      direction === "BT"
        ? centerCoordinate(target, "y") < centerCoordinate(source, "y")
        : centerCoordinate(target, "y") > centerCoordinate(source, "y")
    if (!forward) continue
    records.push({
      edge,
      sourcePort: portForTravel(source, travel, "source"),
      targetPort: portForTravel(target, travel, "target"),
    })
  }
  return records
}

function horizontalExitSubgraph(diagram: FlowchartDiagram, edge: FlowchartEdge): FlowchartSubgraph | undefined {
  for (const subgraph of [...(diagram.subgraphs ?? [])].reverse()) {
    if (subgraph.direction !== "LR" && subgraph.direction !== "RL") continue
    if (subgraph.nodeIds.includes(edge.from) && !subgraph.nodeIds.includes(edge.to)) return subgraph
  }
  return undefined
}

function horizontalEntrySubgraph(diagram: FlowchartDiagram, edge: FlowchartEdge): FlowchartSubgraph | undefined {
  for (const subgraph of [...(diagram.subgraphs ?? [])].reverse()) {
    if (subgraph.direction !== "LR" && subgraph.direction !== "RL") continue
    if (subgraph.nodeIds.includes(edge.to) && !subgraph.nodeIds.includes(edge.from)) return subgraph
  }
  return undefined
}

function horizontalSubgraphEntryTravel(subgraph: FlowchartSubgraph): HorizontalTravel {
  return subgraph.direction === "RL" ? "left" : "right"
}

function horizontalSubgraphEntryLane(subgraph: FlowchartSubgraph, subgraphBound: FlowchartSubgraphBounds): number {
  return subgraph.direction === "RL"
    ? subgraphBound.left + subgraphBound.width + BUS_CLEARANCE
    : subgraphBound.left - BUS_CLEARANCE
}

function horizontalSubgraphJoinY(from: FlowchartSubgraphBounds, targetSubgraphBound: FlowchartSubgraphBounds): number {
  if (from.centerY <= targetSubgraphBound.centerY) {
    const start = from.top + from.height
    const end = targetSubgraphBound.top - 1
    return start <= end ? Math.floor((start + end) / 2) : start
  }

  const start = targetSubgraphBound.top + targetSubgraphBound.height
  const end = from.top - 1
  return start <= end ? Math.floor((start + end) / 2) : end
}

function horizontalSubgraphExitJoinY(
  from: FlowchartSubgraphBounds,
  targetPort: FlowchartPoint,
  targetBelow: boolean,
): number {
  if (targetBelow) {
    const outside = from.top + from.height
    const beforeTarget = targetPort.y - 1
    const preferred = targetPort.y - BUS_CLEARANCE
    return outside <= beforeTarget ? Math.min(Math.max(outside, preferred), beforeTarget) : beforeTarget
  }

  const outside = from.top - 1
  const afterTarget = targetPort.y + 1
  const preferred = targetPort.y + BUS_CLEARANCE
  return afterTarget <= outside ? Math.max(Math.min(outside, preferred), afterTarget) : afterTarget
}

function groupRecords<Record>(records: readonly Record[], key: (record: Record) => string): Map<string, Record[]> {
  const groups = new Map<string, Record[]>()
  for (const record of records) {
    const groupKey = key(record)
    const group = groups.get(groupKey) ?? []
    group.push(record)
    groups.set(groupKey, group)
  }
  return groups
}

function fanRoute(
  edge: FlowchartEdge,
  sourcePort: FlowchartPoint,
  targetPort: FlowchartPoint,
  routeLane: DiagramLane,
): FlowchartEdgeRoute {
  return { edge, points: pathViaLane(sourcePort, routeLane, targetPort) }
}

function alignClusteredVerticalSources(records: readonly EdgeRecord[]): EdgeRecord[] {
  const xs = records.map((record) => record.sourcePort.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  if (maxX - minX > 1) return [...records]

  const x = Math.round(xs.reduce((total, value) => total + value, 0) / xs.length)
  return records.map((record) => ({ ...record, sourcePort: { ...record.sourcePort, x } }))
}

function routeHorizontalFanOut(
  records: readonly EdgeRecord[],
  bounds: ReadonlyMap<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  const reservedBusLanes = new Set<number>()
  const targetOwners = new Map<string, string>()
  for (const [sourceId, sourceRecords] of groupRecords(records, (record) => record.edge.from)) {
    if (sourceRecords.length < 2) continue
    const travel = direction === "RL" ? "left" : "right"
    const sourcePort = sourceRecords[0]!.sourcePort
    const targetPorts = sourceRecords.map((record) => record.targetPort)

    const busX = reserveFanOutLane(sourcePort, targetPorts, "x", travel, reservedBusLanes)
    for (const record of sourceRecords) {
      const targetOwner = targetOwners.get(record.edge.to)
      targetOwners.set(record.edge.to, targetOwner ?? sourceId)
      const target = bounds.get(record.edge.to)
      if (!targetOwner || targetOwner === sourceId || !target) {
        routes.push(fanRoute(record.edge, sourcePort, record.targetPort, lane("x", busX)))
        handled.add(record.edge)
        continue
      }

      const targetSide = sourcePort.y < record.targetPort.y ? "top" : "bottom"
      const targetPoint = boundsSidePoint(target, targetSide)
      const approach = shiftPoint(targetPoint, targetSide === "top" ? "up" : "down")
      routes.push({
        edge: record.edge,
        points: pathThrough([
          sourcePort,
          { x: busX, y: sourcePort.y },
          { x: busX, y: approach.y },
          approach,
          targetPoint,
        ]),
      })
      handled.add(record.edge)
    }
  }
}

function routeHorizontalFanIn(
  records: readonly EdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  const unhandledRecords = records.filter((record) => !handled.has(record.edge))
  for (const targetRecords of groupRecords(unhandledRecords, (record) => record.edge.to).values()) {
    if (targetRecords.length < 2) continue
    const travel = direction === "RL" ? "left" : "right"
    const targetPort = targetRecords[0]!.targetPort
    const sourcePorts = targetRecords.map((record) => record.sourcePort)

    const busX = targetFanInLane(sourcePorts, targetPort, "x", travel)
    for (const record of targetRecords) {
      routes.push(fanRoute(record.edge, record.sourcePort, targetPort, lane("x", busX)))
      handled.add(record.edge)
    }
  }
}

function routeVerticalFanOut(
  records: readonly EdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  for (const sourceRecords of groupRecords(records, (record) => record.edge.from).values()) {
    if (sourceRecords.length < 2) continue
    const travel = direction === "BT" ? "up" : "down"
    const sourcePort = sourceRecords[0]!.sourcePort
    const targetPorts = sourceRecords.map((record) => record.targetPort)

    const busY = sourceFanOutLane(sourcePort, targetPorts, "y", travel)
    for (const record of sourceRecords) {
      routes.push(fanRoute(record.edge, sourcePort, record.targetPort, lane("y", busY)))
      handled.add(record.edge)
    }
  }
}

function routeVerticalFanIn(
  records: readonly EdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  const unhandledRecords = records.filter((record) => !handled.has(record.edge))
  for (const unalignedTargetRecords of groupRecords(unhandledRecords, (record) => record.edge.to).values()) {
    const targetRecords = alignClusteredVerticalSources(unalignedTargetRecords)
    if (targetRecords.length < 2) continue
    const travel = direction === "BT" ? "up" : "down"
    const targetPort = targetRecords[0]!.targetPort
    const sourcePorts = targetRecords.map((record) => record.sourcePort)

    const busY = targetFanInLane(sourcePorts, targetPort, "y", travel)
    for (const record of targetRecords) {
      routes.push(fanRoute(record.edge, record.sourcePort, targetPort, lane("y", busY)))
      handled.add(record.edge)
    }
  }
}

function routeParallelEdges(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  const groups = groupRecords(diagram.edges, (edge) => `${edge.from}:${edge.to}`)
  for (const edges of groups.values()) {
    if (edges.length < 2) continue
    const from = bounds.get(edges[0]!.from)
    const to = bounds.get(edges[0]!.to)
    if (!from || !to || from.id === to.id) continue
    const parallelAxis = parallelLaneAxis(from, to)
    let previousRoute: FlowchartEdgeRoute | undefined
    for (const edge of edges) {
      const height = labelHeight(edge)
      const laneCoordinate =
        parallelAxis === "x"
          ? previousRoute
            ? rightRenderExtent(previousRoute) + NODE_CLEARANCE
            : Math.max(boundsSidePoint(from, "right").x, boundsSidePoint(to, "right").x)
          : previousRoute
            ? Math.max(...previousRoute.points.map((point) => point.y)) + (height > 1 ? height + 1 : 1)
            : Math.max(boundsSidePoint(from, "bottom").y, boundsSidePoint(to, "bottom").y) + (height > 1 ? height : 0)
      const route: FlowchartEdgeRoute = {
        edge,
        points: parallelEdgePath(from, to, parallelAxis, laneCoordinate),
        labelAxis: parallelAxis === "x" ? "y" : "x",
      }
      routes.push(route)
      handled.add(edge)
      previousRoute = route
    }
  }
}

function routeHorizontalSubgraphExitFanIn(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  subgraphBounds: ReadonlyMap<string, FlowchartSubgraphBounds> | undefined,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  if (!subgraphBounds) return

  const groups = new Map<string, { edge: FlowchartEdge; subgraph: FlowchartSubgraph; source: FlowchartNodeBounds }[]>()
  for (const edge of diagram.edges) {
    if (handled.has(edge)) continue
    const subgraph = horizontalExitSubgraph(diagram, edge)
    const source = bounds.get(edge.from)
    const target = bounds.get(edge.to)
    if (!subgraph || !source || !target) continue

    const key = `${subgraph.id}:${edge.to}`
    const group = groups.get(key) ?? []
    group.push({ edge, subgraph, source })
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    const subgraph = group[0]!.subgraph
    const subgraphBound = subgraphBounds.get(subgraph.id)
    const target = bounds.get(group[0]!.edge.to)
    if (!subgraphBound || !target) continue

    const travel: HorizontalTravel = subgraph.direction === "RL" ? "left" : "right"
    const busX =
      subgraph.direction === "RL"
        ? subgraphBound.left - BUS_CLEARANCE
        : subgraphBound.left + subgraphBound.width + BUS_CLEARANCE
    const targetSubgraph = horizontalEntrySubgraph(diagram, group[0]!.edge)
    const targetSubgraphBound = targetSubgraph ? subgraphBounds.get(targetSubgraph.id) : undefined
    const targetBelow = target.centerY >= subgraphBound.centerY
    const targetPort = targetSubgraph
      ? portForTravel(target, horizontalSubgraphEntryTravel(targetSubgraph), "target")
      : boundsSidePoint(target, targetBelow ? "top" : "bottom")
    const joinY = targetSubgraphBound
      ? horizontalSubgraphJoinY(subgraphBound, targetSubgraphBound)
      : horizontalSubgraphExitJoinY(subgraphBound, targetPort, targetBelow)
    const entryX =
      targetSubgraph && targetSubgraphBound
        ? horizontalSubgraphEntryLane(targetSubgraph, targetSubgraphBound)
        : targetPort.x

    for (const record of group) {
      const sourcePort = portForTravel(record.source, travel, "source")
      routes.push({
        edge: record.edge,
        points: pathThrough([
          sourcePort,
          { x: busX, y: sourcePort.y },
          { x: busX, y: joinY },
          { x: entryX, y: joinY },
          { x: entryX, y: targetPort.y },
          targetPort,
        ]),
      })
      handled.add(record.edge)
    }
  }
}

function routeHorizontalSubgraphEntries(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  subgraphBounds: ReadonlyMap<string, FlowchartSubgraphBounds> | undefined,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  if (!subgraphBounds) return

  for (const edge of diagram.edges) {
    if (handled.has(edge)) continue
    const subgraph = horizontalEntrySubgraph(diagram, edge)
    const subgraphBound = subgraph ? subgraphBounds.get(subgraph.id) : undefined
    const from = bounds.get(edge.from)
    const to = bounds.get(edge.to)
    if (!subgraph || !subgraphBound || !from || !to) continue

    const targetPort = portForTravel(to, horizontalSubgraphEntryTravel(subgraph), "target")
    const entryX = horizontalSubgraphEntryLane(subgraph, subgraphBound)
    const travel = verticalTravel(from, to)
    const sourcePort = portForTravel(from, travel, "source")
    routes.push({
      edge,
      points: pathThrough([sourcePort, { x: entryX, y: sourcePort.y }, { x: entryX, y: targetPort.y }, targetPort]),
    })
    handled.add(edge)
  }
}

function pathIntersectsBounds(
  points: readonly FlowchartPoint[],
  bounds: { left: number; top: number; width: number; height: number },
  allowedContact: "source" | "target" | "both" | undefined = undefined,
): boolean {
  const right = bounds.left + bounds.width - 1
  const bottom = bounds.top + bounds.height - 1
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!
    const to = points[index]!
    if (from.x === to.x) {
      if (from.x < bounds.left || from.x > right) continue
      const overlapTop = Math.max(Math.min(from.y, to.y), bounds.top)
      const overlapBottom = Math.min(Math.max(from.y, to.y), bottom)
      if (overlapTop > overlapBottom) continue
      const sourceContact =
        (allowedContact === "source" || allowedContact === "both") &&
        index === 1 &&
        overlapTop === overlapBottom &&
        from.x === points[0]!.x &&
        overlapTop === points[0]!.y
      const targetContact =
        (allowedContact === "target" || allowedContact === "both") &&
        index === points.length - 1 &&
        overlapTop === overlapBottom &&
        to.x === points.at(-1)!.x &&
        overlapTop === points.at(-1)!.y
      if (!sourceContact && !targetContact) return true
      continue
    }
    if (from.y < bounds.top || from.y > bottom) continue
    const overlapLeft = Math.max(Math.min(from.x, to.x), bounds.left)
    const overlapRight = Math.min(Math.max(from.x, to.x), right)
    if (overlapLeft > overlapRight) continue
    const sourceContact =
      (allowedContact === "source" || allowedContact === "both") &&
      index === 1 &&
      overlapLeft === overlapRight &&
      overlapLeft === points[0]!.x &&
      from.y === points[0]!.y
    const targetContact =
      (allowedContact === "target" || allowedContact === "both") &&
      index === points.length - 1 &&
      overlapLeft === overlapRight &&
      overlapLeft === points.at(-1)!.x &&
      to.y === points.at(-1)!.y
    if (!sourceContact && !targetContact) return true
  }
  return false
}

function labelIntersectsBounds(
  label: FlowchartEdgeLabelLayout | undefined,
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  if (!label) return false
  return (
    label.point.x <= bounds.left + bounds.width - 1 &&
    label.point.x + label.width - 1 >= bounds.left &&
    label.point.y <= bounds.top + bounds.height - 1 &&
    label.point.y + label.height - 1 >= bounds.top
  )
}

function labelIntersectsSubgraphFrame(
  label: FlowchartEdgeLabelLayout | undefined,
  bounds: FlowchartSubgraphBounds,
): boolean {
  if (!label) return false
  const labelRight = label.point.x + label.width - 1
  const labelBottom = label.point.y + label.height - 1
  const right = bounds.left + bounds.width - 1
  const bottom = bounds.top + bounds.height - 1
  return (
    (label.point.x <= right &&
      labelRight >= bounds.left &&
      ((label.point.y <= bounds.top && labelBottom >= bounds.top) ||
        (label.point.y <= bottom && labelBottom >= bottom))) ||
    (label.point.y <= bottom &&
      labelBottom >= bounds.top &&
      ((label.point.x <= bounds.left && labelRight >= bounds.left) || (label.point.x <= right && labelRight >= right)))
  )
}

function routeLength(route: FlowchartEdgeRoute): number {
  let length = 0
  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1]!
    const to = route.points[index]!
    length += Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
  }
  return length
}

function labelIntersectsLabels(
  label: FlowchartEdgeLabelLayout | undefined,
  otherLabels: readonly FlowchartEdgeLabelLayout[],
): boolean {
  if (!label) return false
  return otherLabels.some((otherLabel) =>
    labelIntersectsBounds(label, {
      left: otherLabel.point.x,
      top: otherLabel.point.y,
      width: otherLabel.width,
      height: otherLabel.height,
    }),
  )
}

function labelIntersectsRoutePaths(
  label: FlowchartEdgeLabelLayout | undefined,
  routes: readonly FlowchartEdgeRoute[],
): boolean {
  if (!label) return false
  return label.lines.some((line, lineIndex) => {
    const width = diagramTextWidth(line) - 2
    if (width <= 0) return false
    return routes.some((route) =>
      pathIntersectsBounds(route.points, {
        left: label.point.x + 1,
        top: label.point.y + lineIndex,
        width,
        height: 1,
      }),
    )
  })
}

function routeIntersectsLabels(route: FlowchartEdgeRoute, labels: readonly FlowchartEdgeLabelLayout[]): boolean {
  return labels.some((label) =>
    label.lines.some((line, lineIndex) => {
      const width = diagramTextWidth(line) - 2
      return (
        width > 0 &&
        pathIntersectsBounds(route.points, {
          left: label.point.x + 1,
          top: label.point.y + lineIndex,
          width,
          height: 1,
        })
      )
    }),
  )
}

function avoidNodeObstacles(
  route: FlowchartEdgeRoute,
  routes: readonly FlowchartEdgeRoute[],
  bounds: Map<string, FlowchartNodeBounds>,
  subgraphBounds: ReadonlyMap<string, FlowchartSubgraphBounds> | undefined,
  routeIndex: number,
): FlowchartEdgeRoute {
  const allNodeBounds = [...bounds.values()]
  const allSubgraphBounds = [...(subgraphBounds?.values() ?? [])]
  const otherRoutes = routes.filter((_, index) => index !== routeIndex)
  const otherLabels = otherRoutes.flatMap((otherRoute) =>
    otherRoute.edge.label ? [flowchartRouteLabelLayout(otherRoute, diagramTextWidth)] : [],
  )
  const intersectsNode = (candidate: FlowchartEdgeRoute): boolean =>
    allNodeBounds.some((bound) => {
      const isSource = bound.id === route.edge.from
      const isTarget = bound.id === route.edge.to
      const allowedContact = isSource && isTarget ? "both" : isSource ? "source" : isTarget ? "target" : undefined
      return pathIntersectsBounds(candidate.points, bound, allowedContact)
    })
  const intersectsObstacle = (candidate: FlowchartEdgeRoute): boolean => {
    const label = candidate.edge.label ? flowchartRouteLabelLayout(candidate, diagramTextWidth) : undefined
    return (
      intersectsNode(candidate) ||
      allNodeBounds.some((bound) => labelIntersectsBounds(label, bound)) ||
      allSubgraphBounds.some((bound) => labelIntersectsSubgraphFrame(label, bound)) ||
      labelIntersectsLabels(label, otherLabels) ||
      labelIntersectsRoutePaths(label, otherRoutes) ||
      routeIntersectsLabels(candidate, otherLabels)
    )
  }
  if (!intersectsObstacle(route)) return route

  const from = bounds.get(route.edge.from)
  const to = bounds.get(route.edge.to)
  if (!from || !to) return route
  const routingBounds = [...allNodeBounds, ...allSubgraphBounds]
  const rightBusX = Math.max(...routingBounds.map((bound) => bound.left + bound.width - 1)) + BUS_CLEARANCE
  const leftBusX = Math.min(...routingBounds.map((bound) => bound.left)) - BUS_CLEARANCE
  const topBusY = Math.min(...routingBounds.map((bound) => bound.top)) - BUS_CLEARANCE
  const bottomBusY = Math.max(...routingBounds.map((bound) => bound.top + bound.height - 1)) + BUS_CLEARANCE
  const rightBusXs = [
    ...new Set([
      rightBusX,
      ...otherLabels.map((label) => Math.max(rightBusX, label.point.x + label.width - 1 + BUS_CLEARANCE)),
    ]),
  ].sort((left, right) => left - right)
  const leftBusXs = [
    ...new Set([leftBusX, ...otherLabels.map((label) => Math.min(leftBusX, label.point.x - BUS_CLEARANCE))]),
  ].sort((left, right) => right - left)
  const topBusYs = [
    ...new Set([topBusY, ...otherLabels.map((label) => Math.min(topBusY, label.point.y - BUS_CLEARANCE))]),
  ].sort((left, right) => right - left)
  const bottomBusYs = [
    ...new Set([
      bottomBusY,
      ...otherLabels.map((label) => Math.max(bottomBusY, label.point.y + label.height - 1 + BUS_CLEARANCE)),
    ]),
  ].sort((left, right) => left - right)
  const busLimit = Math.max(1, Math.floor(Math.sqrt(ROUTING_CANDIDATE_BUDGET / 4)))
  const candidateLeftBusXs = leftBusXs.length > busLimit ? leftBusXs.slice(0, busLimit) : leftBusXs
  const candidateRightBusXs = rightBusXs.length > busLimit ? rightBusXs.slice(0, busLimit) : rightBusXs
  const candidateTopBusYs = topBusYs.length > busLimit ? topBusYs.slice(0, busLimit) : topBusYs
  const candidateBottomBusYs = bottomBusYs.length > busLimit ? bottomBusYs.slice(0, busLimit) : bottomBusYs
  const buses = [
    ...candidateLeftBusXs.map((coordinate) => lane("x", coordinate)),
    ...candidateRightBusXs.map((coordinate) => lane("x", coordinate)),
    ...candidateTopBusYs.map((coordinate) => lane("y", coordinate)),
    ...candidateBottomBusYs.map((coordinate) => lane("y", coordinate)),
  ]
  const routeViaBus = (start: FlowchartPoint, targetSide: DiagramSide, bus: DiagramLane): FlowchartEdgeRoute => {
    const end = boundsSidePoint(to, targetSide)
    const approach = shiftPoint(
      end,
      targetSide === "left" ? "left" : targetSide === "right" ? "right" : targetSide === "top" ? "up" : "down",
    )
    return {
      ...route,
      labelAxis: route.labelAxis === undefined ? undefined : bus.axis === "x" ? "y" : "x",
      points:
        bus.axis === "x"
          ? pathThrough([start, { x: bus.coordinate, y: start.y }, { x: bus.coordinate, y: approach.y }, approach, end])
          : pathThrough([
              start,
              { x: start.x, y: bus.coordinate },
              { x: approach.x, y: bus.coordinate },
              approach,
              end,
            ]),
    }
  }
  const selfLoops =
    from.id !== to.id
      ? []
      : [
          ...candidateRightBusXs.flatMap((busX) =>
            candidateBottomBusYs.map(
              (busY): FlowchartEdgeRoute => ({
                ...route,
                points: pathThrough([
                  boundsSidePoint(from, "right"),
                  { x: busX, y: from.centerY },
                  { x: busX, y: busY },
                  { x: from.centerX, y: busY },
                  boundsSidePoint(from, "bottom"),
                ]),
              }),
            ),
          ),
          ...candidateBottomBusYs.flatMap((busY) =>
            candidateLeftBusXs.map(
              (busX): FlowchartEdgeRoute => ({
                ...route,
                points: pathThrough([
                  boundsSidePoint(from, "bottom"),
                  { x: from.centerX, y: busY },
                  { x: busX, y: busY },
                  { x: busX, y: from.centerY },
                  boundsSidePoint(from, "left"),
                ]),
              }),
            ),
          ),
          ...candidateLeftBusXs.flatMap((busX) =>
            candidateTopBusYs.map(
              (busY): FlowchartEdgeRoute => ({
                ...route,
                points: pathThrough([
                  boundsSidePoint(from, "left"),
                  { x: busX, y: from.centerY },
                  { x: busX, y: busY },
                  { x: from.centerX, y: busY },
                  boundsSidePoint(from, "top"),
                ]),
              }),
            ),
          ),
          ...candidateTopBusYs.flatMap((busY) =>
            candidateRightBusXs.map(
              (busX): FlowchartEdgeRoute => ({
                ...route,
                points: pathThrough([
                  boundsSidePoint(from, "top"),
                  { x: from.centerX, y: busY },
                  { x: busX, y: busY },
                  { x: busX, y: from.centerY },
                  boundsSidePoint(from, "right"),
                ]),
              }),
            ),
          ),
        ]
  const targetSides = ["left", "right", "top", "bottom"] satisfies DiagramSide[]
  const shortest = (candidates: FlowchartEdgeRoute[], accept: (candidate: FlowchartEdgeRoute) => boolean) =>
    candidates.filter(accept).sort((left, right) => routeLength(left) - routeLength(right))[0]
  if (from.id === to.id)
    return (
      shortest(selfLoops, (candidate) => !intersectsObstacle(candidate)) ??
      shortest(selfLoops, (candidate) => !intersectsNode(candidate)) ??
      route
    )
  const currentTargetSide = sideForOutsidePoint(to, route.points.at(-1)!)
  const preservedTargets = buses.map((bus) => routeViaBus(route.points[0]!, currentTargetSide, bus))
  const sameSides: FlowchartEdgeRoute[] = [
    ...candidateRightBusXs.map(
      (busX): FlowchartEdgeRoute => ({
        ...route,
        labelAxis: route.labelAxis === undefined ? undefined : "y",
        points: pathViaLane(boundsSidePoint(from, "right"), lane("x", busX), boundsSidePoint(to, "right")),
      }),
    ),
    ...candidateLeftBusXs.map(
      (busX): FlowchartEdgeRoute => ({
        ...route,
        labelAxis: route.labelAxis === undefined ? undefined : "y",
        points: pathViaLane(boundsSidePoint(from, "left"), lane("x", busX), boundsSidePoint(to, "left")),
      }),
    ),
    ...candidateTopBusYs.map(
      (busY): FlowchartEdgeRoute => ({
        ...route,
        labelAxis: route.labelAxis === undefined ? undefined : "x",
        points: pathViaLane(boundsSidePoint(from, "top"), lane("y", busY), boundsSidePoint(to, "top")),
      }),
    ),
    ...candidateBottomBusYs.map(
      (busY): FlowchartEdgeRoute => ({
        ...route,
        labelAxis: route.labelAxis === undefined ? undefined : "x",
        points: pathViaLane(boundsSidePoint(from, "bottom"), lane("y", busY), boundsSidePoint(to, "bottom")),
      }),
    ),
  ]
  const preservedSources = targetSides.flatMap((targetSide) =>
    buses.map((bus) => routeViaBus(route.points[0]!, targetSide, bus)),
  )
  const attachments = targetSides.flatMap((sourceSide) =>
    targetSides.flatMap((targetSide) =>
      buses.map((bus) => routeViaBus(boundsSidePoint(from, sourceSide), targetSide, bus)),
    ),
  )
  if (subgraphBounds) {
    return (
      shortest(preservedTargets, (candidate) => !intersectsObstacle(candidate)) ??
      shortest(sameSides, (candidate) => !intersectsObstacle(candidate)) ??
      shortest(preservedSources, (candidate) => !intersectsObstacle(candidate)) ??
      shortest(attachments, (candidate) => !intersectsObstacle(candidate)) ??
      shortest(preservedSources, (candidate) => !intersectsNode(candidate)) ??
      shortest(attachments, (candidate) => !intersectsNode(candidate)) ??
      route
    )
  }
  return (
    sameSides.find((candidate) => !intersectsObstacle(candidate)) ??
    shortest(preservedTargets, (candidate) => !intersectsObstacle(candidate)) ??
    attachments.find((candidate) => !intersectsObstacle(candidate)) ??
    shortest(preservedSources, (candidate) => !intersectsObstacle(candidate)) ??
    shortest(attachments, (candidate) => !intersectsNode(candidate)) ??
    shortest(preservedSources, (candidate) => !intersectsNode(candidate)) ??
    route
  )
}

function avoidLabelOverlap(
  route: FlowchartEdgeRoute,
  otherRoutes: readonly FlowchartEdgeRoute[],
  bounds: ReadonlyMap<string, FlowchartNodeBounds>,
  subgraphBounds: ReadonlyMap<string, FlowchartSubgraphBounds> | undefined,
): FlowchartEdgeRoute {
  if (!route.edge.label) return route
  const nodeBounds = [...bounds.values()]
  const frameBounds = [...(subgraphBounds?.values() ?? [])]
  const otherLabels = otherRoutes.flatMap((other) =>
    other.edge.label ? [flowchartRouteLabelLayout(other, diagramTextWidth)] : [],
  )
  const otherConnectorBounds = otherRoutes.flatMap((other) => {
    const source = bounds.get(other.edge.from)
    const sourcePoint = other.points[0]
    if (!source || !sourcePoint) return []
    const connector = flowchartSourceConnector(source, sourcePoint)
    return [
      { left: connector.x, top: connector.y, width: 1, height: 1 },
      { left: sourcePoint.x, top: sourcePoint.y, width: 1, height: 1 },
    ]
  })
  const intersectsObstacle = (label: FlowchartEdgeLabelLayout): boolean =>
    nodeBounds.some((bound) => labelIntersectsBounds(label, bound)) ||
    frameBounds.some((bound) => labelIntersectsSubgraphFrame(label, bound)) ||
    labelIntersectsLabels(label, otherLabels) ||
    labelIntersectsRoutePaths(label, otherRoutes) ||
    otherConnectorBounds.some((bound) => labelIntersectsBounds(label, bound))
  const current = flowchartRouteLabelLayout(route, diagramTextWidth)
  if (!intersectsObstacle(current)) return route

  const seen = new Set<string>()
  let remaining = ROUTING_CANDIDATE_BUDGET
  const available = (candidate: FlowchartPoint) => {
    remaining--
    const key = `${candidate.x}:${candidate.y}`
    if (seen.has(key)) return false
    seen.add(key)
    return !intersectsObstacle({ ...current, point: candidate })
  }
  for (let index = 1; index < route.points.length && remaining > 0; index++) {
    const segment = segmentBetween(route.points[index - 1]!, route.points[index]!)
    if (!segment) continue
    const label = flowchartEdgeLabelLayout(route.points, route.edge.label, diagramTextWidth, route.labelAxis, index - 1)
    const fixed =
      segment.axis === "y"
        ? [label.point, { x: segment.from.x - label.width, y: label.point.y }]
        : [
            label.point,
            { x: label.point.x, y: segment.from.y - label.height },
            { x: label.point.x, y: segment.from.y + 1 },
          ]
    for (const candidate of fixed) {
      if (remaining <= 0) return route
      if (available(candidate)) return { ...route, labelPoint: candidate }
    }
    if (segment.axis === "y") {
      const bottom = Math.max(segment.from.y, segment.to.y) - label.height + 1
      for (let y = Math.min(segment.from.y, segment.to.y); y <= bottom && remaining > 0; y++) {
        for (const x of [segment.from.x + 1, segment.from.x - label.width]) {
          const candidate = { x, y }
          if (available(candidate)) return { ...route, labelPoint: candidate }
          if (remaining <= 0) return route
        }
      }
      continue
    }
    const right = Math.max(segment.from.x, segment.to.x) - label.width + 1
    for (let x = Math.min(segment.from.x, segment.to.x); x <= right && remaining > 0; x++) {
      for (const y of [segment.from.y, segment.from.y - label.height, segment.from.y + 1]) {
        const candidate = { x, y }
        if (available(candidate)) return { ...route, labelPoint: candidate }
        if (remaining <= 0) return route
      }
    }
  }
  return route
}

export function routeFlowchartEdges(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  directionForEdge: (edge: FlowchartEdge) => FlowchartDirection = () => diagram.direction,
  subgraphBounds?: ReadonlyMap<string, FlowchartSubgraphBounds>,
): FlowchartEdgeRoute[] {
  const routedDiagram = { ...diagram, edges: diagram.edges.filter((edge) => !edge.orderOnly) }
  const handled = new Set<FlowchartEdge>()
  const routes: FlowchartEdgeRoute[] = []
  const leftBoundary = subgraphBounds
    ? Math.min(...[...bounds.values(), ...subgraphBounds.values()].map((bound) => bound.left))
    : undefined

  routeParallelEdges(routedDiagram, bounds, handled, routes)

  for (const direction of ["LR", "RL"] satisfies FlowchartDirection[]) {
    const horizontalEdges = routedDiagram.edges.filter(
      (edge) => !handled.has(edge) && directionForEdge(edge) === direction,
    )
    if (horizontalEdges.length === 0) continue
    const records = horizontalForwardRecords(horizontalEdges, bounds, direction)
    routeHorizontalFanOut(records, bounds, direction, handled, routes)
    routeHorizontalFanIn(records, direction, handled, routes)
  }

  routeHorizontalSubgraphExitFanIn(routedDiagram, bounds, subgraphBounds, handled, routes)
  routeHorizontalSubgraphEntries(routedDiagram, bounds, subgraphBounds, handled, routes)

  for (const direction of ["TD", "TB", "BT"] satisfies FlowchartDirection[]) {
    const verticalEdges = routedDiagram.edges.filter(
      (edge) => !handled.has(edge) && directionForEdge(edge) === direction,
    )
    if (verticalEdges.length === 0) continue
    const records = verticalForwardRecords(verticalEdges, bounds, direction)
    routeVerticalFanOut(records, direction, handled, routes)
    routeVerticalFanIn(records, direction, handled, routes)
  }

  for (const edge of routedDiagram.edges) {
    if (handled.has(edge)) continue
    const from = bounds.get(edge.from)
    const to = bounds.get(edge.to)
    if (!from || !to) continue
    routes.push({ edge, points: edgePath(from, to, directionForEdge(edge), leftBoundary) })
  }
  for (let index = routes.length - 1; index >= 0; index--) {
    routes[index] = avoidNodeObstacles(routes[index]!, routes, bounds, subgraphBounds, index)
  }
  return routes.reduce<FlowchartEdgeRoute[]>((resolved, route, index) => {
    return [...resolved, avoidLabelOverlap(route, [...resolved, ...routes.slice(index + 1)], bounds, subgraphBounds)]
  }, [])
}

function sideForOutsidePoint(bounds: FlowchartNodeBounds, sourcePoint: FlowchartPoint): DiagramSide {
  if (sourcePoint.x < bounds.left) return "left"
  if (sourcePoint.x >= bounds.left + bounds.width) return "right"
  if (sourcePoint.y < bounds.top) return "top"
  return "bottom"
}

function connectorChar(side: DiagramSide): string {
  switch (side) {
    case "left":
      return "┤"
    case "right":
      return "├"
    case "top":
      return "┴"
    case "bottom":
      return "┬"
  }
}

export function flowchartSourceConnector(
  from: FlowchartNodeBounds,
  sourcePoint: FlowchartPoint,
): { x: number; y: number; char: string } {
  const side = sideForOutsidePoint(from, sourcePoint)
  const connector = boundsSidePoint(from, side, "border")
  return {
    x: side === "top" || side === "bottom" ? sourcePoint.x : connector.x,
    y: side === "left" || side === "right" ? sourcePoint.y : connector.y,
    char: connectorChar(side),
  }
}
