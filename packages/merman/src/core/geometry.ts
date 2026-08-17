export type DiagramAxis = "x" | "y"
export type DiagramDirection = "up" | "down" | "left" | "right"
export type DiagramSide = "left" | "right" | "top" | "bottom"

export interface DiagramPoint {
  x: number
  y: number
}

export interface DiagramBounds {
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export interface DiagramSegment {
  from: DiagramPoint
  to: DiagramPoint
  axis: DiagramAxis
  direction: DiagramDirection
  length: number
}

export interface DiagramLane {
  axis: DiagramAxis
  coordinate: number
}

export interface DiagramSpan {
  start: number
  end: number
}

const DIRECTION_AXIS = {
  left: "x",
  right: "x",
  up: "y",
  down: "y",
} as const satisfies Record<DiagramDirection, DiagramAxis>

const DIRECTION_SIGN = {
  left: -1,
  right: 1,
  up: -1,
  down: 1,
} as const satisfies Record<DiagramDirection, -1 | 1>

const DIRECTION_SIDE = {
  left: "left",
  right: "right",
  up: "top",
  down: "bottom",
} as const satisfies Record<DiagramDirection, DiagramSide>

const OPPOSITE_SIDE = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
} as const satisfies Record<DiagramSide, DiagramSide>

export function point(x: number, y: number): DiagramPoint {
  return { x, y }
}

export function diagramBoundsFromRect(left: number, top: number, width: number, height: number): DiagramBounds {
  return {
    left,
    top,
    width,
    height,
    centerX: left + Math.floor(width / 2),
    centerY: top + Math.floor(height / 2),
  }
}

export function translateDiagramBounds(bounds: DiagramBounds, dx: number, dy: number): void {
  bounds.left += dx
  bounds.top += dy
  bounds.centerX += dx
  bounds.centerY += dy
}

export function diagramBoundsFromBounds(bounds: readonly DiagramBounds[]): DiagramBounds | undefined {
  if (bounds.length === 0) return undefined
  const left = Math.min(...bounds.map((bound) => bound.left))
  const top = Math.min(...bounds.map((bound) => bound.top))
  const right = Math.max(...bounds.map((bound) => bound.left + bound.width))
  const bottom = Math.max(...bounds.map((bound) => bound.top + bound.height))
  return diagramBoundsFromRect(left, top, right - left, bottom - top)
}

export function diagramBoundsFromPoints(points: readonly DiagramPoint[]): DiagramBounds | undefined {
  if (points.length === 0) return undefined
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  return diagramBoundsFromRect(left, top, right - left + 1, bottom - top + 1)
}

export function coordinate(point: DiagramPoint, axis: DiagramAxis): number {
  return point[axis]
}

export function withCoordinate(point: DiagramPoint, axis: DiagramAxis, value: number): DiagramPoint {
  return axis === "x" ? { x: value, y: point.y } : { x: point.x, y: value }
}

export function shiftPoint(point: DiagramPoint, direction: DiagramDirection, distance = 1): DiagramPoint {
  switch (direction) {
    case "left":
      return { x: point.x - distance, y: point.y }
    case "right":
      return { x: point.x + distance, y: point.y }
    case "up":
      return { x: point.x, y: point.y - distance }
    case "down":
      return { x: point.x, y: point.y + distance }
  }
}

export function clampPoint(point: DiagramPoint, min: DiagramPoint = { x: 0, y: 0 }): DiagramPoint {
  return { x: Math.max(min.x, point.x), y: Math.max(min.y, point.y) }
}

export function samePoint(left: DiagramPoint, right: DiagramPoint): boolean {
  return left.x === right.x && left.y === right.y
}

export function directionAxis(direction: DiagramDirection): DiagramAxis {
  return DIRECTION_AXIS[direction]
}

export function directionSign(direction: DiagramDirection): -1 | 1 {
  return DIRECTION_SIGN[direction]
}

export function sideForDirection(direction: DiagramDirection): DiagramSide {
  return DIRECTION_SIDE[direction]
}

export function oppositeSide(side: DiagramSide): DiagramSide {
  return OPPOSITE_SIDE[side]
}

export function directionBetween(from: DiagramPoint, to: DiagramPoint): DiagramDirection | undefined {
  if (from.y === to.y) {
    if (to.x > from.x) return "right"
    if (to.x < from.x) return "left"
  }
  if (from.x === to.x) {
    if (to.y > from.y) return "down"
    if (to.y < from.y) return "up"
  }
  return undefined
}

export function boundsCenter(bounds: DiagramBounds): DiagramPoint {
  return point(bounds.centerX, bounds.centerY)
}

export function boundsSidePoint(
  bounds: DiagramBounds,
  side: DiagramSide,
  surface: "border" | "outside" = "outside",
): DiagramPoint {
  switch (side) {
    case "left":
      return point(bounds.left - (surface === "outside" ? 1 : 0), bounds.centerY)
    case "right":
      return point(bounds.left + bounds.width - (surface === "outside" ? 0 : 1), bounds.centerY)
    case "top":
      return point(bounds.centerX, bounds.top - (surface === "outside" ? 1 : 0))
    case "bottom":
      return point(bounds.centerX, bounds.top + bounds.height - (surface === "outside" ? 0 : 1))
  }
}

export function centerCoordinate(bounds: DiagramBounds, axis: DiagramAxis): number {
  return axis === "x" ? bounds.centerX : bounds.centerY
}

export function snapCoordinate(source: number, target: number, tolerance: number): number {
  return Math.abs(source - target) <= tolerance ? target : source
}

export function pathThrough(points: readonly DiagramPoint[]): DiagramPoint[] {
  const path: DiagramPoint[] = []
  for (const next of points) {
    if (!path.length || !samePoint(path[path.length - 1]!, next)) path.push(point(next.x, next.y))
  }
  return path
}

export function lane(axis: DiagramAxis, coordinate: number): DiagramLane {
  return { axis, coordinate }
}

export function pathViaLane(start: DiagramPoint, routeLane: DiagramLane, end: DiagramPoint): DiagramPoint[] {
  return pathThrough([
    start,
    withCoordinate(start, routeLane.axis, routeLane.coordinate),
    withCoordinate(end, routeLane.axis, routeLane.coordinate),
    end,
  ])
}

function dominantAxis(start: DiagramPoint, end: DiagramPoint): DiagramAxis {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? "x" : "y"
}

function terminalLane(start: DiagramPoint, end: DiagramPoint, axis: DiagramAxis, terminalClearance: number): number {
  const startCoordinate = coordinate(start, axis)
  const endCoordinate = coordinate(end, axis)
  const delta = endCoordinate - startCoordinate
  const sign = Math.sign(delta)
  if (sign === 0) return endCoordinate
  return endCoordinate - sign * Math.min(terminalClearance, Math.max(1, Math.abs(delta) - 1))
}

export function orthogonalPath(
  start: DiagramPoint,
  end: DiagramPoint,
  options: { preferredAxis?: DiagramAxis; terminalClearance?: number } = {},
): DiagramPoint[] {
  if (start.x === end.x || start.y === end.y) return pathThrough([start, end])

  const laneAxis = options.preferredAxis ?? dominantAxis(start, end)
  return pathViaLane(start, lane(laneAxis, terminalLane(start, end, laneAxis, options.terminalClearance ?? 4)), end)
}

export function segmentBetween(from: DiagramPoint, to: DiagramPoint): DiagramSegment | undefined {
  const direction = directionBetween(from, to)
  if (!direction) return undefined
  return {
    from,
    to,
    axis: directionAxis(direction),
    direction,
    length: Math.abs(coordinate(to, directionAxis(direction)) - coordinate(from, directionAxis(direction))),
  }
}

export function walkOrthogonalSegment(
  from: DiagramPoint,
  to: DiagramPoint,
  includeStart: boolean,
  visit: (point: DiagramPoint) => boolean | void,
): void {
  const direction = directionBetween(from, to)
  if (!direction) return

  const dx = direction === "right" ? 1 : direction === "left" ? -1 : 0
  const dy = direction === "down" ? 1 : direction === "up" ? -1 : 0
  let cursor = includeStart ? from : point(from.x + dx, from.y + dy)

  while (!samePoint(cursor, to)) {
    if (visit(cursor) === false) return
    cursor = point(cursor.x + dx, cursor.y + dy)
  }
}

export function orthogonalPathPoints(points: readonly DiagramPoint[]): DiagramPoint[] {
  const path: DiagramPoint[] = []
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!
    const to = points[index]!
    const direction = directionBetween(from, to)
    if (!direction) continue

    const dx = direction === "right" ? 1 : direction === "left" ? -1 : 0
    const dy = direction === "down" ? 1 : direction === "up" ? -1 : 0
    let cursor = path.length === 0 ? point(from.x, from.y) : point(from.x + dx, from.y + dy)
    while (true) {
      path.push(cursor)
      if (samePoint(cursor, to)) break
      cursor = point(cursor.x + dx, cursor.y + dy)
    }
  }
  return path
}

export function orderedSpan(left: number, right: number): DiagramSpan {
  return left <= right ? { start: left, end: right } : { start: right, end: left }
}

export function segmentSpan(segment: DiagramSegment): DiagramSpan {
  return orderedSpan(coordinate(segment.from, segment.axis), coordinate(segment.to, segment.axis))
}

export function pointOnSegment(segment: DiagramSegment, coordinateValue: number): DiagramPoint {
  return withCoordinate(segment.from, segment.axis, coordinateValue)
}

export function insetSpan(span: DiagramSpan, amount: number): DiagramSpan {
  return { start: span.start + amount, end: span.end - amount }
}

export function spanCapacity(span: DiagramSpan): number {
  return Math.max(0, span.end - span.start + 1)
}

export function centeredSpanStart(span: DiagramSpan, width: number): number {
  return span.start + Math.floor((spanCapacity(span) - width) / 2)
}

export function midpoint(span: DiagramSpan): number {
  return Math.round((span.start + span.end) / 2)
}

export function advanceCoordinate(origin: number, direction: DiagramDirection, distance: number): number {
  return origin + directionSign(direction) * distance
}

export function beforeNearestCoordinate(
  points: readonly DiagramPoint[],
  axis: DiagramAxis,
  direction: DiagramDirection,
  clearance: number,
): number {
  const coordinates = points.map((point) => coordinate(point, axis))
  const nearest = directionSign(direction) > 0 ? Math.min(...coordinates) : Math.max(...coordinates)
  return advanceCoordinate(nearest, direction, -clearance)
}

export function afterFarthestCoordinate(
  points: readonly DiagramPoint[],
  axis: DiagramAxis,
  direction: DiagramDirection,
  clearance: number,
): number {
  const coordinates = points.map((point) => coordinate(point, axis))
  const farthest = directionSign(direction) > 0 ? Math.max(...coordinates) : Math.min(...coordinates)
  return advanceCoordinate(farthest, direction, clearance)
}

export function keepBefore(preferred: number, boundary: number, direction: DiagramDirection): number {
  return directionSign(direction) > 0 ? Math.min(preferred, boundary) : Math.max(preferred, boundary)
}

export function keepAfter(preferred: number, boundary: number, direction: DiagramDirection): number {
  return directionSign(direction) > 0 ? Math.max(preferred, boundary) : Math.min(preferred, boundary)
}
