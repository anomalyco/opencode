import type { DiagramPoint } from "../core/geometry.js"
import type { SpatialIndex, SpatialRole } from "../core/spatial.js"

const MAX_RENDER_SEARCH_VISITS = 250_000

export interface StateSearchBudget {
  remaining: number
}

export interface StateSearchSpace {
  blocked: ReadonlySet<string>
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function createStateSearchBudget(): StateSearchBudget {
  return { remaining: MAX_RENDER_SEARCH_VISITS }
}

export function createStateSearchSpace(
  space: SpatialIndex,
  clearance: (role: SpatialRole) => number = () => 0,
): StateSearchSpace {
  const blocked = new Set<string>()
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0

  for (const claim of space.claims) {
    const padding = clearance(claim.role)
    for (const span of claim.spans) {
      for (let y = span.y - padding; y <= span.y + padding; y++) {
        for (let x = span.fromX - padding; x <= span.toX + padding; x++) {
          blocked.add(`${x}:${y}`)
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }
  }

  return { blocked, minX, minY, maxX, maxY }
}

export function findStateManhattanPath(
  starts: readonly DiagramPoint[],
  goal: DiagramPoint,
  space: Pick<StateSearchSpace, "blocked">,
  bounds: Pick<StateSearchSpace, "minX" | "minY" | "maxX" | "maxY">,
  budget: StateSearchBudget,
  isFree: (point: DiagramPoint) => boolean = (point) => !space.blocked.has(pointKey(point)),
): DiagramPoint[] | undefined {
  const queue = [...new Map(starts.filter(isFree).map((point) => [pointKey(point), point])).values()]
  const parents = new Map(queue.map((point) => [pointKey(point), undefined as string | undefined]))
  const points = new Map(queue.map((point) => [pointKey(point), point]))

  for (let cursor = 0; cursor < queue.length && budget.remaining > 0; cursor++, budget.remaining--) {
    const current = queue[cursor]!
    if (current.x === goal.x && current.y === goal.y) break
    const dx = Math.sign(goal.x - current.x)
    const dy = Math.sign(goal.y - current.y)
    const candidates = [
      ...(dx === 0 ? [] : [{ x: current.x + dx, y: current.y }]),
      ...(dy === 0 ? [] : [{ x: current.x, y: current.y + dy }]),
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y - 1 },
    ]
    for (const candidate of candidates) {
      if (
        candidate.x < bounds.minX ||
        candidate.x > bounds.maxX ||
        candidate.y < bounds.minY ||
        candidate.y > bounds.maxY
      )
        continue
      const key = pointKey(candidate)
      if (parents.has(key) || !isFree(candidate)) continue
      parents.set(key, pointKey(current))
      points.set(key, candidate)
      queue.push(candidate)
    }
  }

  if (!parents.has(pointKey(goal))) return undefined
  const path: DiagramPoint[] = []
  let cursor: string | undefined = pointKey(goal)
  while (cursor) {
    path.push(points.get(cursor)!)
    cursor = parents.get(cursor)
  }
  return path.reverse()
}

function pointKey(point: DiagramPoint): string {
  return `${point.x}:${point.y}`
}
