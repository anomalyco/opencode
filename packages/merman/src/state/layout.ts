import { translateDiagramBounds } from "../core/geometry.js"
import { diagramTextWidth, measureDiagramTextBox, splitDiagramLines } from "../core/text.js"
import {
  hasReverseTransition,
  isStateHorizontalFeedback,
  measureStateTransitionLabel,
  type StateTransitionRenderPlan,
} from "./routing.js"
import type {
  StateDiagram,
  StateDiagramCompositeState,
  StateDiagramNote,
  StateDiagramState,
  StateDiagramTransition,
} from "./types.js"

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
}

export interface StateDiagramLayoutOptions {
  minStateGap: number
}

function visualLength(value: string): number {
  return diagramTextWidth(value)
}

function splitStateDiagramLines(value: string): string[] {
  return splitDiagramLines(value)
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

function reaches(diagram: StateDiagram, from: string, target: string): boolean {
  const outgoing = outgoingTransitions(diagram)
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
  const start = diagram.states.find((state) => state.kind === "start")?.id ?? diagram.states[0]?.id
  if (!start) return []

  const path = [start]
  const visited = new Set(path)
  let current = start
  while (true) {
    const candidates = (outgoing.get(current) ?? []).filter((transition) => !visited.has(transition.to))
    if (candidates.length === 0) break
    const next =
      candidates.find((transition) => diagram.states.find((state) => state.id === transition.to)?.kind === "end") ??
      candidates.find((transition) => !reaches(diagram, transition.to, current)) ??
      candidates.find((transition) => !hasReverseTransition(diagram, transition))
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
  const lines = note.lines.flatMap(splitStateDiagramLines).map((line) => line.trim())
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

function shiftBounds(bounds: Iterable<StateDiagramBoxBounds>, dx: number, dy: number): void {
  for (const bound of bounds) {
    translateDiagramBounds(bound, dx, dy)
  }
}

function uniqueBounds(...bounds: Iterable<StateDiagramBoxBounds>[]): StateDiagramBoxBounds[] {
  return [...new Set(bounds.flatMap((group) => [...group]))]
}

function normalizeLayout(layout: StateDiagramLayout): void {
  const allBounds = uniqueBounds(layout.bounds.values(), layout.compositeBounds.values(), layout.noteBounds)
  if (allBounds.length === 0) return
  const minX = Math.min(0, ...allBounds.map((bound) => bound.left))
  const minY = Math.min(0, ...allBounds.map((bound) => bound.top))
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
    const width = Math.max(right - left, visualLength(composite.label) + 5)
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

function addNoteBounds(diagram: StateDiagram, layout: StateDiagramLayout): void {
  const compositeIds = new Set(diagram.composites.map((composite) => composite.id))
  const avoidBounds = [...layout.bounds.values()].filter((bound) => !compositeIds.has(bound.id))
  const noteBounds: StateDiagramNoteBounds[] = []

  for (const [index, note] of diagram.notes.entries()) {
    const target = layout.bounds.get(note.target)
    if (!target) continue
    const size = noteSize(note)
    noteBounds.push(placeNote(note, index, target, size, avoidBounds, noteBounds))
  }

  layout.noteBounds = noteBounds
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

function placeNote(
  note: StateDiagramNote,
  index: number,
  target: StateDiagramBoxBounds,
  size: { width: number; height: number; lines: string[] },
  avoidBounds: readonly StateDiagramBoxBounds[],
  existingNotes: readonly StateDiagramNoteBounds[],
): StateDiagramNoteBounds {
  const gap = 4
  const baseLeft = note.position === "right" ? target.left + target.width + gap : target.left - size.width - gap
  const baseTop = target.centerY - Math.floor(size.height / 2)
  const candidateTops = [
    baseTop,
    target.top - size.height - 2,
    target.top + target.height + 2,
    baseTop - size.height - 2,
    baseTop + target.height + 2,
  ]
  const collides = (left: number, top: number) => {
    for (const bound of avoidBounds) {
      if (bound.id !== target.id && intersects(left, top, size.width, size.height, bound)) return true
    }
    for (const bound of existingNotes) {
      if (intersects(left, top, size.width, size.height, bound)) return true
    }
    return false
  }

  for (const top of candidateTops) {
    if (!collides(baseLeft, top)) return createNoteBound(note, index, baseLeft, top, size)
  }

  const shiftedLeft =
    note.position === "right"
      ? Math.max(...avoidBounds.map((bound) => bound.left + bound.width), target.left + target.width) + gap
      : Math.min(...avoidBounds.map((bound) => bound.left), target.left) - size.width - gap
  return createNoteBound(note, index, shiftedLeft, baseTop + target.height + 1, size)
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

    const childBounds = [bound, ...descendantNotes]
    const noteTop = Math.min(...childBounds.map((child) => child.top), bound.top)
    const noteBottom = Math.max(...childBounds.map((child) => child.top + child.height), bound.top + bound.height)
    const left = Math.min(...childBounds.map((child) => child.left)) - 2
    const top = noteTop < bound.top ? noteTop - 1 : bound.top
    const right = Math.max(...childBounds.map((child) => child.left + child.width)) + 2
    const bottom = noteBottom > bound.top + bound.height ? noteBottom + 1 : bound.top + bound.height

    bound.left = left
    bound.top = top
    bound.width = Math.max(right - left, visualLength(composite.label) + 5)
    bound.height = bottom - top
    bound.centerX = bound.left + Math.floor(bound.width / 2)
    bound.centerY = bound.top + Math.floor(bound.height / 2)
  }
}

function boundsIntersect(left: StateDiagramBoxBounds, right: StateDiagramBoxBounds): boolean {
  return intersects(left.left, left.top, left.width, left.height, right, 0)
}

function separateExternalBoundsFromComposites(diagram: StateDiagram, layout: StateDiagramLayout): void {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

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

      shiftBounds(uniqueBounds(boundsToShift), dx, 0)
    }
  }
}

function finalizeLayout(diagram: StateDiagram, layout: StateDiagramLayout): StateDiagramLayout {
  if (diagram.composites.length === 0 && diagram.notes.length === 0) return layout
  addCompositeBounds(diagram, layout)
  normalizeLayout(layout)
  addNoteBounds(diagram, layout)
  expandCompositeBoundsForNotes(diagram, layout)
  separateExternalBoundsFromComposites(diagram, layout)
  normalizeLayout(layout)
  return layout
}

export function createStateDiagramLayout(
  diagram: StateDiagram,
  options: StateDiagramLayoutOptions,
): StateDiagramLayout {
  if (diagram.direction === "LR" || diagram.direction === "RL") {
    return finalizeLayout(diagram, createHorizontalLayout(diagram, options))
  }

  const ranks = computeRanks(diagram)
  const byRank = new Map<number, StateDiagramState[]>()
  for (const state of diagram.states) {
    const rank = ranks.get(state.id) ?? 0
    const list = byRank.get(rank) ?? []
    list.push(state)
    byRank.set(rank, list)
  }

  const rankKeys = [...byRank.keys()].sort((a, b) => a - b)
  const sizes = new Map(diagram.states.map((state) => [state.id, stateSize(state)]))
  const bounds = new Map<string, StateDiagramBoxBounds>()
  const outgoingLabelRows = new Map<string, number>()
  for (const transition of diagram.transitions) {
    const rows = measureStateTransitionLabel(transition.label).height
    outgoingLabelRows.set(transition.from, Math.max(outgoingLabelRows.get(transition.from) ?? 0, rows))
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
    y += rowHeight + Math.max(4, labelRows + 3)
  }

  return finalizeLayout(diagram, emptyLayout(bounds, sizes))
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
    x += size.width + Math.max(defaultGap, adjacentLabelWidth + 2)
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
      const top = baselineY + (parallelLane ? 6 : 5)
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
  const fallbackStates = diagram.states.filter((state) => !bounds.has(state.id))
  for (const state of fallbackStates) {
    const size = sizes.get(state.id)!
    const rank = ranks.get(state.id) ?? bounds.size
    const top = baselineY + 5
    const left = rank * (size.width + defaultGap)
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
    const occupiedYs = internalPlans.flatMap((plan) => [
      ...plan.cells.map((cell) => cell.y),
      ...(plan.label ? plan.label.lines.map((_, index) => plan.label!.y + index) : []),
    ])
    if (occupiedYs.length === 0) continue

    const top = Math.min(bound.top, Math.min(...occupiedYs) - 1)
    const bottom = Math.max(bound.top + bound.height, Math.max(...occupiedYs) + 2)
    bound.top = top
    bound.height = bottom - top
    bound.centerY = bound.top + Math.floor(bound.height / 2)
  }
}
