import { orthogonalPathPoints, translateDiagramBounds, type DiagramPoint } from "../core/geometry.js"
import { SpatialIndex, spatialPathClaim, spatialRectClaim } from "../core/spatial.js"
import { diagramTextWidth, measureDiagramTextBox, splitDiagramLines } from "../core/text.js"
import { stateDiagramNoteConnector, type StateDiagramNoteConnector } from "./note.js"
import {
  createStateTransitionRenderPlans,
  hasReverseTransition,
  isStateHorizontalFeedback,
  measureStateTransitionLabel,
  type StateTransitionRenderPlan,
} from "./routing.js"
import {
  createStateSearchBudget,
  createStateSearchSpace,
  findStateManhattanPath,
  type StateSearchBudget,
  type StateSearchSpace,
} from "./search.js"
import type {
  StateDiagram,
  StateDiagramCompositeState,
  StateDiagramNote,
  StateDiagramState,
  StateDiagramTransition,
} from "./types.js"

const MAX_STRICT_NOTE_PLACEMENTS = 24

export interface StateDiagramBoxBounds {
  id: string
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export interface StateDiagramLayout {
  bounds: Map<string, StateDiagramBoxBounds>
  sizes: Map<string, { width: number; height: number; lines: string[] }>
  compositeBounds: Map<string, StateDiagramBoxBounds>
  noteBounds: StateDiagramNoteBounds[]
}

export interface StateDiagramNoteBounds extends StateDiagramBoxBounds {
  note: StateDiagramNote
  lines: string[]
  connector?: StateDiagramNoteConnector
}

export interface StateDiagramLayoutOptions {
  minStateGap: number
  searchBudget?: StateSearchBudget
}

function computeRanks(diagram: StateDiagram): Map<string, number> {
  const ranks = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const transition of diagram.transitions) {
    const list = outgoing.get(transition.from) ?? []
    list.push(transition.to)
    outgoing.set(transition.from, list)
  }

  const first = diagram.states.find((state) => state.kind === "start")?.id ?? diagram.states[0]?.id
  if (!first) return ranks
  ranks.set(first, 0)
  const queue = [first]
  while (queue.length > 0) {
    const id = queue.shift()!
    const rank = ranks.get(id) ?? 0
    for (const to of outgoing.get(id) ?? []) {
      const nextRank = rank + 1
      if ((ranks.get(to) ?? Number.POSITIVE_INFINITY) <= nextRank) continue
      ranks.set(to, nextRank)
      queue.push(to)
    }
  }

  for (const state of diagram.states) {
    if (!ranks.has(state.id)) ranks.set(state.id, ranks.size)
  }
  return ranks
}

function outgoingTransitions(diagram: StateDiagram): Map<string, StateDiagramTransition[]> {
  const outgoing = new Map<string, StateDiagramTransition[]>()
  for (const transition of diagram.transitions) {
    const list = outgoing.get(transition.from) ?? []
    list.push(transition)
    outgoing.set(transition.from, list)
  }
  return outgoing
}

function reaches(
  outgoing: ReadonlyMap<string, readonly StateDiagramTransition[]>,
  from: string,
  target: string,
): boolean {
  const visited = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === target) return true
    if (visited.has(id)) continue
    visited.add(id)
    for (const transition of outgoing.get(id) ?? []) stack.push(transition.to)
  }
  return false
}

function computeMainPath(diagram: StateDiagram): string[] {
  const outgoing = outgoingTransitions(diagram)
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const start = diagram.states.find((state) => state.kind === "start")?.id ?? diagram.states[0]?.id
  if (!start) return []

  const path = [start]
  const visited = new Set(path)
  let current = start
  while (true) {
    const candidates = (outgoing.get(current) ?? []).filter((transition) => !visited.has(transition.to))
    if (candidates.length === 0) break
    const next =
      candidates.find((transition) => statesById.get(transition.to)?.kind === "end") ??
      candidates.find((transition) => !reaches(outgoing, transition.to, current)) ??
      candidates.find((transition) => !hasReverseTransition(diagram, transition)) ??
      candidates.find((transition) => {
        const fromParent = statesById.get(current)?.parentId
        const toParent = statesById.get(transition.to)?.parentId
        return Boolean(fromParent && toParent && fromParent !== toParent)
      }) ??
      (path.length === 1 && candidates.length === 1 ? candidates[0] : undefined)
    if (!next) break
    path.push(next.to)
    visited.add(next.to)
    current = next.to
  }

  return path
}

function stateSize(state: StateDiagramState): { width: number; height: number; lines: string[] } {
  if (state.kind !== "state") return { width: 1, height: 1, lines: [state.label] }
  return measureDiagramTextBox(state.label, { paddingX: 2, paddingY: 1 })
}

function noteLines(note: StateDiagramNote): string[] {
  const lines = note.lines.flatMap(splitDiagramLines).map((line) => line.trim())
  return lines.length > 0 ? lines : [""]
}

function noteSize(note: StateDiagramNote): { width: number; height: number; lines: string[] } {
  const lines = noteLines(note)
  const innerWidth = Math.max(...lines.map(diagramTextWidth), 1)
  return { width: innerWidth + 4, height: lines.length + 2, lines }
}

function emptyLayout(
  bounds: Map<string, StateDiagramBoxBounds>,
  sizes: Map<string, { width: number; height: number; lines: string[] }>,
): StateDiagramLayout {
  return { bounds, sizes, compositeBounds: new Map(), noteBounds: [] }
}

function isNoteBound(bound: StateDiagramBoxBounds): bound is StateDiagramNoteBounds {
  return "note" in bound
}

function shiftBounds(bounds: Iterable<StateDiagramBoxBounds>, dx: number, dy: number): void {
  for (const bound of bounds) {
    translateDiagramBounds(bound, dx, dy)
    if (!isNoteBound(bound) || !bound.connector) continue
    bound.connector = {
      connectorY: bound.connector.connectorY + dy,
      points: bound.connector.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    }
  }
}

export function translateStateDiagramLayout(layout: StateDiagramLayout, dx: number, dy: number): void {
  shiftBounds(uniqueBounds(layout.bounds.values(), layout.compositeBounds.values(), layout.noteBounds), dx, dy)
}

function uniqueBounds(...bounds: Iterable<StateDiagramBoxBounds>[]): StateDiagramBoxBounds[] {
  return [...new Set(bounds.flatMap((group) => [...group]))]
}

function normalizeLayout(layout: StateDiagramLayout): void {
  const allBounds = uniqueBounds(layout.bounds.values(), layout.compositeBounds.values(), layout.noteBounds)
  if (allBounds.length === 0) return
  const connectorPoints = layout.noteBounds.flatMap((bound) => bound.connector?.points ?? [])
  const minX = Math.min(0, ...allBounds.map((bound) => bound.left), ...connectorPoints.map((point) => point.x))
  const minY = Math.min(0, ...allBounds.map((bound) => bound.top), ...connectorPoints.map((point) => point.y))
  if (minX === 0 && minY === 0) return
  shiftBounds(allBounds, -minX, -minY)
}

function addCompositeBounds(diagram: StateDiagram, layout: StateDiagramLayout): void {
  const statesByParent = new Map<string, string[]>()
  const compositesByParent = new Map<string, StateDiagramCompositeState[]>()
  for (const state of diagram.states) {
    if (!state.parentId) continue
    const states = statesByParent.get(state.parentId) ?? []
    states.push(state.id)
    statesByParent.set(state.parentId, states)
  }
  for (const composite of diagram.composites) {
    if (!composite.parentId) continue
    const composites = compositesByParent.get(composite.parentId) ?? []
    composites.push(composite)
    compositesByParent.set(composite.parentId, composites)
  }

  const addComposite = (composite: StateDiagramCompositeState): StateDiagramBoxBounds | undefined => {
    const existing = layout.compositeBounds.get(composite.id)
    if (existing) return existing

    for (const child of compositesByParent.get(composite.id) ?? []) addComposite(child)

    const childBounds = [
      ...(statesByParent.get(composite.id) ?? []),
      ...(compositesByParent.get(composite.id) ?? []).map((child) => child.id),
    ]
      .map((id) => layout.bounds.get(id))
      .filter((bound): bound is StateDiagramBoxBounds => Boolean(bound))
    if (childBounds.length === 0) return undefined

    const left = Math.min(...childBounds.map((bound) => bound.left)) - 2
    const top = Math.min(...childBounds.map((bound) => bound.top)) - 2
    const right = Math.max(...childBounds.map((bound) => bound.left + bound.width)) + 2
    const bottom = Math.max(...childBounds.map((bound) => bound.top + bound.height)) + 2
    const width = Math.max(right - left, diagramTextWidth(composite.label) + 5)
    const bound = {
      id: composite.id,
      left,
      top,
      width,
      height: bottom - top,
      centerX: left + Math.floor(width / 2),
      centerY: top + Math.floor((bottom - top) / 2),
    }
    layout.compositeBounds.set(composite.id, bound)
    layout.bounds.set(composite.id, bound)
    return bound
  }

  for (const composite of diagram.composites) addComposite(composite)
}

function intersects(
  left: number,
  top: number,
  width: number,
  height: number,
  bound: StateDiagramBoxBounds,
  padding = 1,
): boolean {
  return (
    left < bound.left + bound.width + padding &&
    left + width + padding > bound.left &&
    top < bound.top + bound.height + padding &&
    top + height + padding > bound.top
  )
}

function createNoteBound(
  note: StateDiagramNote,
  index: number,
  left: number,
  top: number,
  size: { width: number; height: number; lines: string[] },
): StateDiagramNoteBounds {
  return {
    id: `${note.target}-note-${index}`,
    left,
    top,
    width: size.width,
    height: size.height,
    centerX: left + Math.floor(size.width / 2),
    centerY: top + Math.floor(size.height / 2),
    note,
    lines: size.lines,
  }
}

function findNoteConnector(
  search: StateSearchSpace,
  bounds: StateDiagramNoteBounds,
  target: StateDiagramBoxBounds,
  budget: StateSearchBudget,
): StateDiagramNoteConnector | undefined {
  const connectorY = Math.max(bounds.top + 1, Math.min(target.centerY, bounds.top + bounds.height - 2))
  const end = {
    x: bounds.note.position === "right" ? bounds.left - 1 : bounds.left + bounds.width,
    y: connectorY,
  }
  const goal = { x: end.x + (bounds.note.position === "right" ? -1 : 1), y: end.y }
  const targetX = bounds.note.position === "right" ? target.left + target.width : target.left - 1
  const preferredStarts = [
    { x: targetX, y: target.centerY },
    { x: targetX, y: target.top - 1 },
    { x: targetX, y: target.top + target.height },
  ]
  const perimeterStarts = [
    ...Array.from({ length: target.height }, (_, offset) => ({ x: target.left - 1, y: target.top + offset })),
    ...Array.from({ length: target.height }, (_, offset) => ({
      x: target.left + target.width,
      y: target.top + offset,
    })),
    ...Array.from({ length: target.width }, (_, offset) => ({ x: target.left + offset, y: target.top - 1 })),
    ...Array.from({ length: target.width }, (_, offset) => ({
      x: target.left + offset,
      y: target.top + target.height,
    })),
  ]
  const starts = [...preferredStarts, ...perimeterStarts]
  const isFree = (point: DiagramPoint): boolean =>
    point.x >= 0 &&
    !search.blocked.has(`${point.x}:${point.y}`) &&
    !(
      point.x >= bounds.left &&
      point.x < bounds.left + bounds.width &&
      point.y >= bounds.top &&
      point.y < bounds.top + bounds.height
    )
  if (!isFree(end) || !isFree(goal)) return undefined

  for (const start of starts.filter(isFree)) {
    const directPaths = [
      [start, { x: start.x, y: goal.y }, goal, end],
      [start, { x: goal.x, y: start.y }, goal, end],
    ]
    const direct = directPaths.find((points) => orthogonalPathPoints(points).every(isFree))
    if (direct) return { connectorY, points: direct }
  }

  const margin = 8
  const minY = Math.min(target.top, bounds.top, search.minY) - margin
  const maxX = Math.max(target.left + target.width, bounds.left + bounds.width, search.maxX) + margin
  const maxY = Math.max(target.top + target.height, bounds.top + bounds.height, search.maxY) + margin
  const path = findStateManhattanPath(starts, goal, search, { minX: 0, minY, maxX, maxY }, budget, isFree)
  return path ? { connectorY, points: [...path, end] } : undefined
}

function belongsToComposite(
  id: string,
  compositeId: string,
  statesById: Map<string, StateDiagramState>,
  compositesById: Map<string, StateDiagramCompositeState>,
): boolean {
  let parentId = statesById.get(id)?.parentId ?? compositesById.get(id)?.parentId

  while (parentId) {
    if (parentId === compositeId) return true
    parentId = compositesById.get(parentId)?.parentId
  }

  return false
}

function expandCompositeBoundsForNotes(diagram: StateDiagram, layout: StateDiagramLayout): void {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

  for (const composite of [...diagram.composites].reverse()) {
    const bound = layout.compositeBounds.get(composite.id)
    if (!bound) continue

    const descendantNotes = layout.noteBounds.filter((noteBound) =>
      belongsToComposite(noteBound.note.target, composite.id, statesById, compositesById),
    )
    if (descendantNotes.length === 0) continue

    const connectorPoints = descendantNotes.flatMap((note) => note.connector?.points ?? [])
    const left = Math.min(
      bound.left,
      ...descendantNotes.map((note) => note.left - 2),
      ...connectorPoints.map((point) => point.x - 1),
    )
    const top = Math.min(
      bound.top,
      ...descendantNotes.map((note) => note.top - 1),
      ...connectorPoints.map((point) => point.y - 1),
    )
    const right = Math.max(
      bound.left + bound.width,
      ...descendantNotes.map((note) => note.left + note.width + 2),
      ...connectorPoints.map((point) => point.x + 2),
    )
    const bottom = Math.max(
      bound.top + bound.height,
      ...descendantNotes.map((note) => note.top + note.height + 1),
      ...connectorPoints.map((point) => point.y + 2),
    )

    bound.left = left
    bound.top = top
    bound.width = Math.max(right - left, diagramTextWidth(composite.label) + 5)
    bound.height = bottom - top
    bound.centerX = bound.left + Math.floor(bound.width / 2)
    bound.centerY = bound.top + Math.floor(bound.height / 2)
  }
}

function expandCompositeBoundsForInternalRouting(diagram: StateDiagram, layout: StateDiagramLayout): void {
  if (diagram.direction === "LR" || diagram.direction === "RL") return
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

  for (const composite of [...diagram.composites].reverse()) {
    const bound = layout.compositeBounds.get(composite.id)
    if (!bound) continue
    const internal = diagram.transitions.filter(
      (transition) =>
        transition.from !== transition.to &&
        innermostCommonCompositeId(transition, statesById, compositesById) === composite.id,
    )
    const endpointOccurrences = new Map<string, number>()
    const sideRoutes = internal.filter((transition) => {
      const from = layout.bounds.get(transition.from)
      const to = layout.bounds.get(transition.to)
      if (!from || !to) return false
      const key = `${transition.from}\u0000${transition.to}`
      const occurrence = endpointOccurrences.get(key) ?? 0
      endpointOccurrences.set(key, occurrence + 1)
      const fromParent = statesById.get(transition.from)?.parentId
      const toParent = statesById.get(transition.to)?.parentId
      return occurrence > 0 || from.centerY > to.centerY || fromParent !== toParent
    })
    if (sideRoutes.length === 0) continue
    const childRight = Math.max(
      ...diagram.states.flatMap((state) => {
        if (!belongsToComposite(state.id, composite.id, statesById, compositesById)) return []
        const child = layout.bounds.get(state.id)
        return child ? [child.left + child.width] : []
      }),
      ...diagram.composites.flatMap((childComposite) => {
        if (childComposite.parentId !== composite.id) return []
        const child = layout.compositeBounds.get(childComposite.id)
        return child ? [child.left + child.width] : []
      }),
    )
    const labelWidth = Math.max(...sideRoutes.map((transition) => measureStateTransitionLabel(transition.label).width))
    const right = childRight + labelWidth + sideRoutes.length * 3 + 6
    if (right <= bound.left + bound.width) continue
    bound.width = right - bound.left
    bound.centerX = bound.left + Math.floor(bound.width / 2)
  }

  enforceCompositeMargins(diagram, layout.compositeBounds)
}

function innermostCommonCompositeId(
  transition: StateDiagramTransition,
  statesById: Map<string, StateDiagramState>,
  compositesById: Map<string, StateDiagramCompositeState>,
): string | undefined {
  const containers = (id: string) => {
    const ids: string[] = []
    let parentId = statesById.get(id)?.parentId ?? compositesById.get(id)?.parentId
    while (parentId) {
      ids.push(parentId)
      parentId = compositesById.get(parentId)?.parentId
    }
    return ids
  }
  const target = new Set(containers(transition.to))
  return containers(transition.from).find((id) => target.has(id))
}

function enforceCompositeMargins(diagram: StateDiagram, compositeBounds: Map<string, StateDiagramBoxBounds>): void {
  const compositesByParent = new Map<string, StateDiagramCompositeState[]>()
  for (const composite of diagram.composites) {
    if (!composite.parentId) continue
    const children = compositesByParent.get(composite.parentId) ?? []
    children.push(composite)
    compositesByParent.set(composite.parentId, children)
  }

  const expand = (composite: StateDiagramCompositeState): StateDiagramBoxBounds | undefined => {
    const bound = compositeBounds.get(composite.id)
    if (!bound) return undefined
    const children = (compositesByParent.get(composite.id) ?? [])
      .map(expand)
      .filter((child): child is StateDiagramBoxBounds => Boolean(child))
    if (children.length === 0) return bound
    const left = Math.min(bound.left, ...children.map((child) => child.left - 2))
    const top = Math.min(bound.top, ...children.map((child) => child.top - 2))
    const right = Math.max(bound.left + bound.width, ...children.map((child) => child.left + child.width + 2))
    const bottom = Math.max(bound.top + bound.height, ...children.map((child) => child.top + child.height + 2))
    bound.left = left
    bound.top = top
    bound.width = right - left
    bound.height = bottom - top
    bound.centerX = left + Math.floor(bound.width / 2)
    bound.centerY = top + Math.floor(bound.height / 2)
    return bound
  }

  for (const composite of diagram.composites.filter((candidate) => !candidate.parentId)) expand(composite)
}

function boundsIntersect(left: StateDiagramBoxBounds, right: StateDiagramBoxBounds): boolean {
  return intersects(left.left, left.top, left.width, left.height, right, 0)
}

export function separateExternalBoundsFromComposites(diagram: StateDiagram, layout: StateDiagramLayout): boolean {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))
  let shifted = false

  for (const composite of diagram.composites) {
    const compositeBound = layout.compositeBounds.get(composite.id)
    if (!compositeBound) continue

    for (const state of diagram.states) {
      if (belongsToComposite(state.id, composite.id, statesById, compositesById)) continue
      const bound = layout.bounds.get(state.id)
      if (!bound || !boundsIntersect(bound, compositeBound)) continue

      const dx = compositeBound.left + compositeBound.width + 4 - bound.left
      if (dx <= 0) continue
      const leftThreshold = bound.left
      const boundsToShift: StateDiagramBoxBounds[] = []

      for (const candidate of diagram.states) {
        if (belongsToComposite(candidate.id, composite.id, statesById, compositesById)) continue
        const candidateBound = layout.bounds.get(candidate.id)
        if (candidateBound && candidateBound.left >= leftThreshold) boundsToShift.push(candidateBound)
      }

      for (const candidate of diagram.composites) {
        if (candidate.id === composite.id || belongsToComposite(candidate.id, composite.id, statesById, compositesById))
          continue
        const candidateBound = layout.compositeBounds.get(candidate.id)
        if (candidateBound && candidateBound.left >= leftThreshold) boundsToShift.push(candidateBound)
      }

      for (const noteBound of layout.noteBounds) {
        const target = layout.bounds.get(noteBound.note.target)
        if (target && boundsToShift.includes(target)) boundsToShift.push(noteBound)
      }

      shiftBounds(uniqueBounds(boundsToShift), dx, 0)
      shifted = true
    }
  }
  return shifted
}

function finalizeLayout(
  diagram: StateDiagram,
  layout: StateDiagramLayout,
  budget: StateSearchBudget,
): StateDiagramLayout {
  if (diagram.composites.length === 0 && diagram.notes.length === 0) return layout
  addCompositeBounds(diagram, layout)
  normalizeLayout(layout)
  expandCompositeBoundsForInternalRouting(diagram, layout)
  if (diagram.notes.length > 0) {
    const allBounds = [...layout.bounds.values()]
    placeStateDiagramNotesAroundTransitions(
      diagram,
      layout,
      createStateTransitionRenderPlans(
        diagram,
        layout.bounds,
        Math.max(0, ...allBounds.map((bound) => bound.top + bound.height)) + 3,
        {
          feedbackTopY: Math.min(0, ...allBounds.map((bound) => bound.top)) - 3,
          repairRoutes: false,
          searchBudget: budget,
        },
      ),
      budget,
    )
  }
  expandCompositeBoundsForNotes(diagram, layout)
  expandCompositeBoundsForInternalRouting(diagram, layout)
  separateExternalBoundsFromComposites(diagram, layout)
  normalizeLayout(layout)
  return layout
}

export function createStateDiagramLayout(
  diagram: StateDiagram,
  options: StateDiagramLayoutOptions,
): StateDiagramLayout {
  const budget = options.searchBudget ?? createStateSearchBudget()
  if (diagram.direction === "LR" || diagram.direction === "RL") {
    return finalizeLayout(diagram, createHorizontalLayout(diagram, options), budget)
  }

  const ranks = computeRanks(diagram)
  const maxRank = Math.max(0, ...ranks.values())
  const byRank = new Map<number, StateDiagramState[]>()
  for (const state of diagram.states) {
    const rank = diagram.direction === "BT" ? maxRank - (ranks.get(state.id) ?? 0) : (ranks.get(state.id) ?? 0)
    const list = byRank.get(rank) ?? []
    list.push(state)
    byRank.set(rank, list)
  }

  const rankKeys = [...byRank.keys()].sort((a, b) => a - b)
  const sizes = new Map(diagram.states.map((state) => [state.id, stateSize(state)]))
  const bounds = new Map<string, StateDiagramBoxBounds>()
  const outgoingLabelRows = new Map<string, number>()
  const selfTransitionCounts = new Map<string, number>()
  for (const transition of diagram.transitions) {
    const rows = measureStateTransitionLabel(transition.label).height
    outgoingLabelRows.set(transition.from, Math.max(outgoingLabelRows.get(transition.from) ?? 0, rows))
    if (transition.from === transition.to) {
      selfTransitionCounts.set(transition.from, (selfTransitionCounts.get(transition.from) ?? 0) + 1)
    }
  }

  const singleColumnCenter = Math.max(
    0,
    ...rankKeys.flatMap((rank) => {
      const states = byRank.get(rank)!
      return states.length === 1 ? [Math.floor(sizes.get(states[0]!.id)!.width / 2)] : []
    }),
  )
  let y = 0
  for (const rank of rankKeys) {
    const states = byRank.get(rank)!
    const rowHeight = Math.max(...states.map((state) => sizes.get(state.id)!.height))
    let x = 0
    for (const state of states) {
      const size = sizes.get(state.id)!
      const top = y + Math.floor((rowHeight - size.height) / 2)
      const left = states.length === 1 ? singleColumnCenter - Math.floor(size.width / 2) : x
      bounds.set(state.id, {
        id: state.id,
        left,
        top,
        width: size.width,
        height: size.height,
        centerX: left + Math.floor(size.width / 2),
        centerY: top + Math.floor(size.height / 2),
      })
      x += size.width + options.minStateGap + 8
    }
    const labelRows = states.reduce((rows, state) => Math.max(rows, outgoingLabelRows.get(state.id) ?? 0), 0)
    const selfTransitionRows = states.reduce(
      (rows, state) => Math.max(rows, (selfTransitionCounts.get(state.id) ?? 0) * 3 + 1),
      0,
    )
    const pseudoStateApproachClearance = states.some((state) => state.kind === "choice") ? 2 : 0
    y += rowHeight + Math.max(4, labelRows + 3, selfTransitionRows) + pseudoStateApproachClearance
  }

  return finalizeLayout(diagram, emptyLayout(bounds, sizes), budget)
}

function createHorizontalLayout(diagram: StateDiagram, options: StateDiagramLayoutOptions): StateDiagramLayout {
  const sizes = new Map(diagram.states.map((state) => [state.id, stateSize(state)]))
  const bounds = new Map<string, StateDiagramBoxBounds>()
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const mainPath = computeMainPath(diagram)
  const mainIds = new Set(mainPath)
  const mainPathIndex = new Map(mainPath.map((id, index) => [id, index]))
  const baselineY = Math.max(
    1,
    ...diagram.transitions.map((transition) => measureStateTransitionLabel(transition.label).height),
  )
  const defaultGap = options.minStateGap + 8
  let x = 0

  for (const [index, id] of mainPath.entries()) {
    const state = statesById.get(id)
    const size = sizes.get(id)
    if (!state || !size) continue
    const top = state.kind === "state" ? baselineY - Math.floor(size.height / 2) : baselineY
    bounds.set(id, {
      id,
      left: x,
      top,
      width: size.width,
      height: size.height,
      centerX: x + Math.floor(size.width / 2),
      centerY: top + Math.floor(size.height / 2),
    })
    const nextId = mainPath[index + 1]
    const adjacentLabelWidth = diagram.transitions
      .filter((transition) => transition.from === id && transition.to === nextId)
      .reduce((width, transition) => Math.max(width, measureStateTransitionLabel(transition.label).width), 0)
    const crossesCompositeBoundary = Boolean(
      nextId && statesById.get(id)?.parentId !== statesById.get(nextId)?.parentId,
    )
    x += size.width + Math.max(defaultGap, adjacentLabelWidth + (crossesCompositeBoundary ? 6 : 2))
  }

  const branchesByParent = new Map<string, string[]>()
  for (const transition of diagram.transitions) {
    if (!mainIds.has(transition.from) || mainIds.has(transition.to)) continue
    const list = branchesByParent.get(transition.from) ?? []
    if (!list.includes(transition.to)) list.push(transition.to)
    branchesByParent.set(transition.from, list)
  }

  for (const [parentId, branchIds] of branchesByParent) {
    const parent = bounds.get(parentId)
    if (!parent) continue
    const branchGap = defaultGap
    const branchSizes = branchIds.map((id) => sizes.get(id)!).filter(Boolean)
    const totalWidth =
      branchSizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, branchSizes.length - 1) * branchGap
    const parentIndex = mainPathIndex.get(parentId)
    const joinIds = branchIds.map(
      (id) =>
        diagram.transitions.find(
          (transition) =>
            transition.from === id &&
            mainIds.has(transition.to) &&
            parentIndex !== undefined &&
            (mainPathIndex.get(transition.to) ?? -1) > parentIndex + 1,
        )?.to,
    )
    const commonJoin = joinIds[0] && joinIds.every((id) => id === joinIds[0]) ? joinIds[0] : undefined
    const parallelLane = commonJoin && parentIndex !== undefined ? bounds.get(mainPath[parentIndex + 1]!) : undefined
    let left = (parallelLane?.centerX ?? parent.centerX) - Math.floor(totalWidth / 2)
    for (const branchId of branchIds) {
      if (bounds.has(branchId)) continue
      const size = sizes.get(branchId)
      if (!size) continue
      const top = availableStateTop(
        [...bounds.values()],
        left,
        baselineY + (parallelLane ? 6 : 5),
        size.width,
        size.height,
      )
      bounds.set(branchId, {
        id: branchId,
        left,
        top,
        width: size.width,
        height: size.height,
        centerX: left + Math.floor(size.width / 2),
        centerY: top + Math.floor(size.height / 2),
      })
      left += size.width + branchGap
    }
  }

  const ranks = computeRanks(diagram)
  const fallbackStates = diagram.states
    .filter((state) => !bounds.has(state.id))
    .sort((left, right) => (ranks.get(left.id) ?? 0) - (ranks.get(right.id) ?? 0))
  for (const state of fallbackStates) {
    const size = sizes.get(state.id)!
    const top = baselineY + 5
    const rank = ranks.get(state.id) ?? bounds.size
    let left = rank * (size.width + defaultGap)
    while (true) {
      const collision = [...bounds.values()].find(
        (bound) =>
          left < bound.left + bound.width + defaultGap &&
          left + size.width + defaultGap > bound.left &&
          top < bound.top + bound.height &&
          top + size.height > bound.top,
      )
      if (!collision) break
      left = collision.left + collision.width + defaultGap
    }
    bounds.set(state.id, {
      id: state.id,
      left,
      top,
      width: size.width,
      height: size.height,
      centerX: left + Math.floor(size.width / 2),
      centerY: top + Math.floor(size.height / 2),
    })
  }

  const minX = Math.min(0, ...[...bounds.values()].map((bound) => bound.left))
  if (minX < 0) {
    for (const bound of bounds.values()) {
      bound.left -= minX
      bound.centerX -= minX
    }
  }

  if (diagram.direction === "RL") {
    const right = Math.max(0, ...[...bounds.values()].map((bound) => bound.left + bound.width))
    for (const bound of bounds.values()) {
      bound.left = right - bound.left - bound.width
      bound.centerX = bound.left + Math.floor(bound.width / 2)
    }

    const branchLabelGutter = Math.max(
      0,
      ...diagram.transitions.flatMap((transition) => {
        const from = bounds.get(transition.from)
        const to = bounds.get(transition.to)
        return from && to && from.centerY !== to.centerY
          ? [measureStateTransitionLabel(transition.label).width + 2]
          : []
      }),
    )
    if (branchLabelGutter > 0) {
      shiftBounds(bounds.values(), branchLabelGutter, 0)
    }
  }

  return emptyLayout(bounds, sizes)
}

function availableStateTop(
  bounds: readonly StateDiagramBoxBounds[],
  left: number,
  top: number,
  width: number,
  height: number,
): number {
  let available = top
  while (true) {
    const collision = bounds.find((bound) => intersects(left, available, width, height, bound, 0))
    if (!collision) return available
    available = collision.top + collision.height + 3
  }
}

export function expandCompositeBoundsForFeedback(
  diagram: StateDiagram,
  bounds: Map<string, StateDiagramBoxBounds>,
  compositeBounds: Map<string, StateDiagramBoxBounds>,
  feedbackLaneY: number,
): void {
  if (diagram.direction !== "LR" && diagram.direction !== "RL") return

  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

  for (const composite of diagram.composites) {
    const compositeBound = compositeBounds.get(composite.id)
    if (!compositeBound) continue

    const hasInternalFeedback = diagram.transitions.some((transition) => {
      if (!belongsToComposite(transition.from, composite.id, statesById, compositesById)) return false
      if (!belongsToComposite(transition.to, composite.id, statesById, compositesById)) return false
      const from = bounds.get(transition.from)
      const to = bounds.get(transition.to)
      return Boolean(from && to && isStateHorizontalFeedback(diagram, from, to))
    })
    if (!hasInternalFeedback) continue

    const bottom = Math.max(compositeBound.top + compositeBound.height, feedbackLaneY + 2)
    compositeBound.height = bottom - compositeBound.top
    compositeBound.centerY = compositeBound.top + Math.floor(compositeBound.height / 2)
  }
}

function placeStateDiagramNotesAroundTransitions(
  diagram: StateDiagram,
  layout: StateDiagramLayout,
  transitionPlans: readonly StateTransitionRenderPlan[],
  budget: StateSearchBudget,
): void {
  if (diagram.notes.length === 0) return
  const compositeIds = new Set(diagram.composites.map((composite) => composite.id))
  let noteSpace = SpatialIndex.empty().add(
    ...[...layout.bounds.values()].flatMap((bound) =>
      compositeIds.has(bound.id) ? [] : [spatialRectClaim(`state:${bound.id}`, `state:${bound.id}`, "body", bound)],
    ),
  )
  let reserved = noteSpace.add(
    ...transitionPlans.flatMap((plan, planIndex) => [
      spatialPathClaim(
        `transition-terminal:${planIndex}:source`,
        `transition-terminal:${planIndex}:source`,
        "route",
        plan.path.slice(0, 2).map(([x, y]) => ({ x, y })),
      ),
      spatialPathClaim(
        `transition-terminal:${planIndex}:target`,
        `transition-terminal:${planIndex}:target`,
        "route",
        plan.path.slice(-2).map(([x, y]) => ({ x, y })),
      ),
    ]),
  )
  let space = reserved.add(
    ...transitionPlans.flatMap((plan, planIndex) => [
      spatialPathClaim(
        `transition:${planIndex}`,
        `transition:${planIndex}`,
        "route",
        plan.path.map(([x, y]) => ({ x, y })),
      ),
      ...(plan.label
        ? [
            spatialRectClaim(`transition-label:${planIndex}`, `transition-label:${planIndex}`, "label", {
              left: plan.label.x,
              top: plan.label.y,
              width: Math.max(...plan.label.lines.map(diagramTextWidth)),
              height: plan.label.lines.length,
            }),
          ]
        : []),
    ]),
  )
  const noteBounds: StateDiagramNoteBounds[] = []

  for (const [index, note] of diagram.notes.entries()) {
    const target = layout.bounds.get(note.target)
    if (!target) continue
    const size = noteSize(note)
    const gap = 4
    const baseLeft = note.position === "right" ? target.left + target.width + gap : target.left - size.width - gap
    const baseTop = target.centerY - Math.floor(size.height / 2)
    const candidates = [
      baseTop,
      target.top - size.height - 2,
      target.top + target.height + 2,
      ...Array.from({ length: 12 }, (_, distance) => [baseTop - distance - 1, baseTop + distance + 1]).flat(),
    ]
    const candidateBounds = Array.from({ length: 5 }, (_, outward) =>
      candidates.map((top) =>
        createNoteBound(
          note,
          index,
          baseLeft + (note.position === "right" ? 1 : -1) * outward * (size.width + 2),
          top,
          size,
        ),
      ),
    ).flat()
    const findPlacement = (candidateSpace: SpatialIndex, limit: number) => {
      const connectorSearch = createStateSearchSpace(candidateSpace, (role) => (role === "label" ? 1 : 0))
      for (const bound of candidateBounds.slice(0, limit)) {
        if (bound.left < 0) continue
        const owner = `note:${index}`
        if (!candidateSpace.isFree(spatialRectClaim(`${owner}:body`, owner, "body", bound), { clearance: 1 })) continue
        const connector = findNoteConnector(connectorSearch, bound, target, budget)
        if (connector) return { bound: { ...bound, connector }, connector }
      }
      return undefined
    }
    const placement =
      findPlacement(space, 1) ??
      findPlacement(noteSpace, 1) ??
      findPlacement(space, MAX_STRICT_NOTE_PLACEMENTS) ??
      findPlacement(reserved, candidateBounds.length) ??
      outsideNotePlacement(noteSpace, note, index, target, size)
    const owner = `note:${index}`
    const claims = [
      spatialRectClaim(`${owner}:body`, owner, "body", placement.bound),
      spatialPathClaim(`${owner}:connector`, owner, "boundary", placement.connector.points),
    ] as const
    noteBounds.push(placement.bound)
    noteSpace = noteSpace.add(...claims)
    reserved = reserved.add(...claims)
    space = space.add(...claims)
  }

  layout.noteBounds.splice(0, layout.noteBounds.length, ...noteBounds)
}

function outsideNotePlacement(
  space: SpatialIndex,
  note: StateDiagramNote,
  index: number,
  target: StateDiagramBoxBounds,
  size: { width: number; height: number; lines: string[] },
): { bound: StateDiagramNoteBounds; connector: StateDiagramNoteConnector } {
  const search = createStateSearchSpace(space)
  const top = search.maxY + 4
  const owner = `note:${index}:outside`

  for (const position of [note.position, note.position === "left" ? "right" : "left"] as const) {
    const aligned = createNoteBound(
      { ...note, position },
      index,
      position === "left" ? search.minX - size.width - 4 : search.maxX + 4,
      target.centerY - Math.floor(size.height / 2),
      size,
    )
    const alignedNoteX = position === "left" ? aligned.left + aligned.width : aligned.left - 1
    const alignedConnectorY = Math.max(aligned.top + 1, Math.min(target.centerY, aligned.top + aligned.height - 2))
    const alignedTargetX = position === "left" ? target.left - 1 : target.left + target.width
    const alignedConnector = {
      connectorY: alignedConnectorY,
      points: [
        { x: alignedTargetX, y: target.centerY },
        { x: alignedNoteX, y: alignedConnectorY },
      ],
    }
    if (
      space.isFree(spatialRectClaim(`${owner}:body`, owner, "body", aligned), { clearance: 1 }) &&
      space.isFree(spatialPathClaim(`${owner}:connector`, owner, "boundary", alignedConnector.points))
    )
      return { bound: { ...aligned, connector: alignedConnector }, connector: alignedConnector }

    const railX = position === "left" ? search.minX - 2 : search.maxX + 2
    const bound = createNoteBound(
      { ...note, position },
      index,
      position === "left" ? railX - size.width - 2 : railX + 3,
      top,
      size,
    )
    const noteX = position === "left" ? bound.left + bound.width : bound.left - 1
    const connectorY = bound.top + 1
    const sideX = position === "left" ? target.left - 1 : target.left + target.width
    const escapes = [
      ...[target.top, target.centerY, target.top + target.height - 1].map((y) => [
        { x: sideX, y },
        { x: railX, y },
      ]),
      [
        { x: target.centerX, y: target.top - 1 },
        { x: railX, y: target.top - 1 },
      ],
      [
        { x: target.centerX, y: target.top + target.height },
        { x: railX, y: target.top + target.height },
      ],
    ]

    for (const escape of escapes) {
      const connector = {
        connectorY,
        points: [...escape, { x: railX, y: connectorY }, { x: noteX, y: connectorY }],
      }
      if (
        space.isFree(spatialRectClaim(`${owner}:body`, owner, "body", bound), { clearance: 1 }) &&
        space.isFree(spatialPathClaim(`${owner}:connector`, owner, "boundary", connector.points))
      )
        return { bound: { ...bound, connector }, connector }
    }
  }

  for (const vertical of ["below", "above"] as const) {
    const railY = vertical === "below" ? search.maxY + 2 : search.minY - 2
    const bound = createNoteBound(
      note,
      index,
      note.position === "left" ? search.minX - size.width - 4 : search.maxX + 4,
      vertical === "below" ? railY + 2 : railY - size.height - 2,
      size,
    )
    const noteX = note.position === "left" ? bound.left + bound.width : bound.left - 1
    const connectorY = bound.top + 1
    const targetY = vertical === "below" ? target.top + target.height : target.top - 1
    const escapes = [
      ...[target.left, target.centerX, target.left + target.width - 1].map((x) => [
        { x, y: targetY },
        { x, y: railY },
      ]),
      [
        { x: target.left, y: targetY },
        { x: target.left - 1, y: targetY },
        { x: target.left - 1, y: railY },
      ],
      [
        { x: target.left + target.width - 1, y: targetY },
        { x: target.left + target.width, y: targetY },
        { x: target.left + target.width, y: railY },
      ],
    ]

    for (const escape of escapes) {
      const connector = {
        connectorY,
        points: [...escape, { x: noteX, y: railY }, { x: noteX, y: connectorY }],
      }
      if (
        space.isFree(spatialRectClaim(`${owner}:body`, owner, "body", bound), { clearance: 1 }) &&
        space.isFree(spatialPathClaim(`${owner}:connector`, owner, "boundary", connector.points))
      )
        return { bound: { ...bound, connector }, connector }
    }
  }

  throw new Error(`State ${note.target} has no exterior note corridor`)
}

export function expandCompositeBoundsForInternalTransitions(
  diagram: StateDiagram,
  compositeBounds: Map<string, StateDiagramBoxBounds>,
  transitionPlans: readonly StateTransitionRenderPlan[],
): void {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

  for (const composite of diagram.composites) {
    const bound = compositeBounds.get(composite.id)
    if (!bound) continue
    const internalPlans = transitionPlans.filter(
      (plan) =>
        belongsToComposite(plan.route.transition.from, composite.id, statesById, compositesById) &&
        belongsToComposite(plan.route.transition.to, composite.id, statesById, compositesById),
    )
    const occupied = internalPlans.flatMap((plan) => [
      ...plan.cells.map((cell) => ({ x: cell.x, y: cell.y })),
      ...(plan.label
        ? plan.label.lines.flatMap((line, row) =>
            Array.from({ length: diagramTextWidth(line) }, (_, column) => ({
              x: plan.label!.x + column,
              y: plan.label!.y + row,
            })),
          )
        : []),
    ])
    if (occupied.length === 0) continue

    const left = Math.min(bound.left, Math.min(...occupied.map((point) => point.x)) - 1)
    const top = Math.min(bound.top, Math.min(...occupied.map((point) => point.y)) - 1)
    const right = Math.max(bound.left + bound.width, Math.max(...occupied.map((point) => point.x)) + 2)
    const bottom = Math.max(bound.top + bound.height, Math.max(...occupied.map((point) => point.y)) + 2)
    bound.left = left
    bound.top = top
    bound.width = right - left
    bound.height = bottom - top
    bound.centerX = bound.left + Math.floor(bound.width / 2)
    bound.centerY = bound.top + Math.floor(bound.height / 2)
  }

  enforceCompositeMargins(diagram, compositeBounds)
}
