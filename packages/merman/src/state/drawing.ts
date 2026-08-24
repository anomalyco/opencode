import { BorderChars, type BorderCharacters, type BorderStyle } from "@opentui/core"
import { DiagramCanvas, type DiagramCanvasCell } from "../core/canvas.js"
import { directionBetween, orthogonalPathPoints, type DiagramDirection } from "../core/geometry.js"
import {
  diagramArrowHead,
  diagramLineGlyph,
  drawDiagramFrame,
  fillDiagramFrameInterior,
  mergeDiagramLineGlyph,
} from "../core/drawing.js"
import {
  createStateDiagramLayout,
  expandCompositeBoundsForFeedback,
  expandCompositeBoundsForInternalTransitions,
  translateStateDiagramLayout,
  type StateDiagramBoxBounds as BoxBounds,
  type StateDiagramNoteBounds as StateNoteBounds,
} from "./layout.js"
import { stateDiagramNoteConnector } from "./note.js"
import { DEFAULT_STATE_ARROW_HEAD_STYLE, DEFAULT_STATE_BORDER_STYLE, normalizeStateMinStateGap } from "./options.js"
import type { StateGrid } from "./render-grid.js"
import {
  createStateTransitionJunctionPlans,
  createStateTransitionRenderPlans,
  measureStateTransitionLabel,
  type StateTransitionRenderPlan,
} from "./routing.js"
import { createStateSearchBudget } from "./search.js"
import type {
  NoteConnectorRampStyle,
  StateCellStyle,
  StateDiagram,
  StateDiagramArrowHeadStyle,
  StateDiagramRenderOptions,
  StateDiagramState,
} from "./types.js"
import { isHiddenCompositeMarker, prepareVisibleStateDiagram } from "./visible-model.js"

type StateCell = DiagramCanvasCell<StateCellStyle>

function translateTransitionPlans(
  plans: readonly StateTransitionRenderPlan[],
  dx: number,
  dy: number,
): StateTransitionRenderPlan[] {
  return plans.map((plan) => ({
    ...plan,
    cells: plan.cells.map((cell) => ({ ...cell, x: cell.x + dx, y: cell.y + dy })),
    path: plan.path.map(([x, y]) => [x + dx, y + dy]),
    label: plan.label ? { ...plan.label, x: plan.label.x + dx, y: plan.label.y + dy } : undefined,
  }))
}

function makeGrid(width: number, height: number): StateGrid {
  return new DiagramCanvas(width, height, {
    mergeCell: (existing, incoming): StateCell => {
      const existingIsTransition = existing.style === "transition" || existing.style?.startsWith("stateDepartureRamp")
      const incomingIsTransition = incoming.style === "transition" || incoming.style?.startsWith("stateDepartureRamp")
      const shouldMerge = incomingIsTransition && (existingIsTransition || existing.style === "composite")
      return {
        ...incoming,
        char: shouldMerge
          ? (mergeDiagramLineGlyph(existing.char, incoming.char, "rounded") ?? incoming.char)
          : incoming.char,
      }
    },
  })
}

function setCell(
  grid: StateGrid,
  x: number,
  y: number,
  char: string,
  style?: StateCellStyle,
): void {
  grid.setCell(x, y, char, style)
}

function setText(
  grid: StateGrid,
  x: number,
  y: number,
  text: string,
  style?: StateCellStyle,
): void {
  grid.setText(x, y, text, style)
}

function drawBox(
  grid: StateGrid,
  state: StateDiagramState,
  bounds: BoxBounds,
  lines: string[],
  borderStyle: BorderStyle,
): void {
  if (isHiddenCompositeMarker(state)) return

  if (state.kind !== "state") {
    setCell(grid, bounds.left, bounds.top, state.label, state.kind)
    return
  }
  const style: StateCellStyle = "state"
  fillDiagramFrameInterior(bounds, (x, y) => setCell(grid, x, y, " ", style))
  drawStateFrame(grid, bounds, BorderChars[borderStyle], style)
  lines.forEach((line, index) => {
    setText(grid, bounds.left + 2, bounds.top + 1 + index, line, style)
  })
}

function drawStateFrame(
  grid: StateGrid,
  bounds: BoxBounds,
  chars: BorderCharacters,
  style: StateCellStyle,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) => setCell(grid, x, y, char, style))
}

function drawContainerFrame(
  grid: StateGrid,
  bounds: BoxBounds,
  label: string,
  chars: BorderCharacters,
  style: StateCellStyle,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) => setCell(grid, x, y, char, style))
  if (label) setText(grid, bounds.left + 2, bounds.top, ` ${label} `, style)
}

function noteConnectorGlyph(directions: ReadonlySet<DiagramDirection>): string {
  const chars = BorderChars.double
  const up = directions.has("up")
  const down = directions.has("down")
  const left = directions.has("left")
  const right = directions.has("right")
  if (up && down && left && right) return chars.cross
  if (up && down && right) return chars.leftT
  if (up && down && left) return chars.rightT
  if (left && right && down) return chars.topT
  if (left && right && up) return chars.bottomT
  if (up && right) return chars.bottomLeft
  if (up && left) return chars.bottomRight
  if (down && right) return chars.topLeft
  if (down && left) return chars.topRight
  if (up || down) return chars.vertical
  return chars.horizontal
}

function drawNote(grid: StateGrid, bounds: StateNoteBounds, target: BoxBounds): void {
  const chars = BorderChars.double
  const connector = stateDiagramNoteConnector(bounds, target)
  const points = orthogonalPathPoints(connector.points)
  for (const [index, point] of points.entries()) {
    const directions = new Set<DiagramDirection>()
    const previous = points[index - 1]
    const next = points[index + 1]
    if (previous) directions.add(directionBetween(point, previous)!)
    if (next) directions.add(directionBetween(point, next)!)
    const distanceFromNote = points.length - index - 1
    const style: StateCellStyle =
      distanceFromNote < 3 ? (`noteConnectorRamp${3 - distanceFromNote}` as NoteConnectorRampStyle) : "noteConnector"
    setCell(grid, point.x, point.y, noteConnectorGlyph(directions), style)
  }

  drawContainerFrame(grid, bounds, "", chars, "noteBorder")
  setCell(
    grid,
    bounds.note.position === "right" ? bounds.left : bounds.left + bounds.width - 1,
    connector.connectorY,
    bounds.note.position === "right" ? chars.rightT : chars.leftT,
    "noteBorder",
  )
  bounds.lines.forEach((line, index) => setText(grid, bounds.left + 2, bounds.top + 1 + index, line, "noteText"))
}

function drawTransitionRenderPlan(
  grid: StateGrid,
  plan: StateTransitionRenderPlan,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  rampDeparture: boolean,
): void {
  const departure = new Map(
    rampDeparture
      ? plan.path.slice(0, 3).map(([x, y], index) => [`${x}:${y}`, `stateDepartureRamp${index + 1}` as StateCellStyle])
      : [],
  )
  for (const cell of plan.cells) {
    const char = cell.arrowDirection ? diagramArrowHead(cell.arrowDirection, arrowHeadStyle) : cell.char
    setCell(grid, cell.x, cell.y, char, departure.get(`${cell.x}:${cell.y}`) ?? "transition")
  }
  if (plan.label) {
    plan.label.lines.forEach((line, index) =>
      setText(grid, plan.label!.x, plan.label!.y + index, line, "label"),
    )
  }
}

function drawTransitionJunctionPlans(
  grid: StateGrid,
  diagram: StateDiagram,
  bounds: Map<string, BoxBounds>,
  renderPlans: readonly StateTransitionRenderPlan[],
): void {
  for (const plan of createStateTransitionJunctionPlans(diagram, bounds, renderPlans)) {
    const style = plan.kind === "choice" ? "choice" : "transition"
    const char = plan.kind === "choice" ? "◆" : diagramLineGlyph(plan.connections, "rounded")
    setCell(grid, plan.bounds.left, plan.bounds.top, char, style)
  }
}

export function drawStateDiagramGrid(sourceDiagram: StateDiagram, options: StateDiagramRenderOptions = {}): StateGrid {
  const directedDiagram = options.direction ? { ...sourceDiagram, direction: options.direction } : sourceDiagram
  const diagram = prepareVisibleStateDiagram(directedDiagram)
  const borderStyle = options.borderStyle ?? DEFAULT_STATE_BORDER_STYLE
  const arrowHeadStyle = options.arrowHeadStyle ?? DEFAULT_STATE_ARROW_HEAD_STYLE
  const minStateGap = normalizeStateMinStateGap(options.minStateGap)
  const searchBudget = createStateSearchBudget()
  const layout = createStateDiagramLayout(diagram, {
    minStateGap,
    searchBudget,
  })
  const { bounds, sizes, compositeBounds, noteBounds } = layout
  let allBounds = [...bounds.values(), ...noteBounds]
  let maxY = Math.max(0, ...allBounds.map((bound) => bound.top + bound.height))
  const feedbackLaneY = maxY + 3
  const feedbackTopY = Math.min(0, ...allBounds.map((bound) => bound.top)) - 3
  expandCompositeBoundsForFeedback(diagram, bounds, compositeBounds, feedbackLaneY)
  let transitionPlans = createStateTransitionRenderPlans(diagram, bounds, feedbackLaneY, {
    feedbackTopY,
    noteBounds,
    searchBudget,
  })
  expandCompositeBoundsForInternalTransitions(diagram, compositeBounds, transitionPlans)
  const connectorPoints = noteBounds.flatMap((bound) => bound.connector?.points ?? [])
  const contentLeft = Math.min(
    0,
    ...[...bounds.values(), ...noteBounds].map((bound) => bound.left),
    ...connectorPoints.map((point) => point.x),
    ...transitionPlans.flatMap((plan) => [
      ...plan.cells.map((cell) => cell.x),
      ...(plan.label ? [plan.label.x] : []),
    ]),
  )
  const contentTop = Math.min(
    0,
    ...[...bounds.values(), ...noteBounds].map((bound) => bound.top),
    ...connectorPoints.map((point) => point.y),
    ...transitionPlans.flatMap((plan) => [...plan.cells.map((cell) => cell.y), ...(plan.label ? [plan.label.y] : [])]),
  )
  if (contentLeft < 0 || contentTop < 0) {
    translateStateDiagramLayout(layout, -contentLeft, -contentTop)
    transitionPlans = translateTransitionPlans(transitionPlans, -contentLeft, -contentTop)
  }
  allBounds = [...bounds.values(), ...noteBounds]
  const translatedConnectorPoints = noteBounds.flatMap((bound) => bound.connector?.points ?? [])
  const maxX = Math.max(
    0,
    ...allBounds.map((bound) => bound.left + bound.width),
    ...translatedConnectorPoints.map((point) => point.x + 1),
  )
  maxY = Math.max(
    0,
    ...allBounds.map((bound) => bound.top + bound.height),
    ...translatedConnectorPoints.map((point) => point.y + 1),
  )
  const transitionLabelSizes = diagram.transitions.map((transition) => measureStateTransitionLabel(transition.label))
  const maxTransitionLabelWidth = Math.max(0, ...transitionLabelSizes.map((size) => size.width))
  const maxTransitionLabelLines = Math.max(0, ...transitionLabelSizes.map((size) => size.height))
  const transitionRight = Math.max(
    maxX,
    ...transitionPlans.flatMap((plan) => [
      ...plan.cells.map((cell) => cell.x + 1),
      ...(plan.label ? [plan.label.x + measureStateTransitionLabel(plan.route.transition.label).width] : []),
    ]),
  )
  const transitionBottom = Math.max(
    maxY,
    ...transitionPlans.flatMap((plan) => [
      ...plan.cells.map((cell) => cell.y + 1),
      ...(plan.label ? [plan.label.y + plan.label.lines.length] : []),
    ]),
  )
  const grid = makeGrid(
    Math.max(maxX + Math.max(24, maxTransitionLabelWidth + 4), transitionRight + 2),
    Math.max(maxY + 8 + maxTransitionLabelLines, transitionBottom + 2),
  )
  for (const composite of diagram.composites) {
    const bound = compositeBounds.get(composite.id)
    if (!bound) continue
    drawContainerFrame(grid, bound, composite.label, BorderChars[borderStyle], "composite")
  }

  for (const state of diagram.states) {
    const bound = bounds.get(state.id)
    const size = sizes.get(state.id)
    if (!bound || !size) continue
    drawBox(grid, state, bound, size.lines, borderStyle)
  }

  for (const plan of transitionPlans) {
    const source = diagram.states.find((state) => state.id === plan.route.transition.from)
    drawTransitionRenderPlan(grid, plan, arrowHeadStyle, source?.kind === "state")
  }

  drawTransitionJunctionPlans(grid, diagram, bounds, transitionPlans)

  for (const noteBound of noteBounds) {
    const target = bounds.get(noteBound.note.target)
    if (target) drawNote(grid, noteBound, target)
  }

  return grid
}
