import { BorderChars, type BorderCharacters, type BorderStyle } from "@opentui/core"
import { DiagramCanvas, type DiagramCanvasCell } from "../core/canvas.js"
import { diagramRadialCellColorLevel } from "../core/color/map.js"
import { diagramArrowHead, diagramLineGlyph, drawDiagramFrame, mergeDiagramLineGlyph } from "../core/drawing.js"
import { activeTransitionIndex, isActiveTransition, normalizeActiveTransitions } from "./active-transition.js"
import {
  createStateDiagramLayout,
  expandCompositeBoundsForFeedback,
  expandCompositeBoundsForInternalTransitions,
  type StateDiagramBoxBounds as BoxBounds,
  type StateDiagramNoteBounds as StateNoteBounds,
} from "./layout.js"
import { DEFAULT_STATE_ARROW_HEAD_STYLE, DEFAULT_STATE_BORDER_STYLE, normalizeStateMinStateGap } from "./options.js"
import type { StateCellMetadata, StateGrid } from "./render-grid.js"
import {
  createStateTransitionJunctionPlans,
  createStateTransitionRenderPlans,
  measureStateTransitionLabel,
  type StateTransitionRenderPlan,
} from "./routing.js"
import {
  isStateActiveTransitionStyle,
  isStateTransitionFadeStyle,
  stateDiagramStateColorKey,
  stateTransitionFadeStyle,
} from "./style.js"
import type {
  FadeSourceStyle,
  StateCellStyle,
  StateDiagram,
  StateDiagramActiveTransition,
  StateDiagramArrowHeadStyle,
  StateDiagramRenderOptions,
  StateDiagramState,
  StateDiagramTransition,
} from "./types.js"
import { isHiddenCompositeMarker, prepareVisibleStateDiagram } from "./visible-model.js"

type StateCell = DiagramCanvasCell<StateCellStyle, StateCellMetadata>

interface TransitionDrawContext {
  fadeSource: FadeSourceStyle
  active: boolean
  fadeFromSource: boolean
  sourceStateId: string
}

function translateTransitionPlans(
  plans: readonly StateTransitionRenderPlan[],
  dy: number,
): StateTransitionRenderPlan[] {
  return plans.map((plan) => ({
    ...plan,
    cells: plan.cells.map((cell) => ({ ...cell, y: cell.y + dy })),
    path: plan.path.map(([x, y]) => [x, y + dy]),
    label: plan.label ? { ...plan.label, y: plan.label.y + dy } : undefined,
  }))
}

function makeGrid(width: number, height: number): StateGrid {
  return new DiagramCanvas(width, height, {
    mergeCell: (existing, incoming): StateCell => {
      const shouldMerge = isTransitionDrawingStyle(existing.style) && isTransitionDrawingStyle(incoming.style)
      return {
        ...incoming,
        char: shouldMerge
          ? (mergeDiagramLineGlyph(existing.char, incoming.char, "rounded") ?? incoming.char)
          : incoming.char,
      }
    },
  })
}

function isTransitionDrawingStyle(style: StateCellStyle | undefined): boolean {
  return (
    style === "transition" ||
    style === "activeTransition" ||
    isStateActiveTransitionStyle(style) ||
    isStateTransitionFadeStyle(style)
  )
}

function setCell(
  grid: StateGrid,
  x: number,
  y: number,
  char: string,
  style?: StateCellStyle,
  stateId?: string,
  bgStateId?: string,
): void {
  grid.setCell(x, y, char, style, { stateId, bgStateId })
}

function setText(
  grid: StateGrid,
  x: number,
  y: number,
  text: string,
  style?: StateCellStyle,
  stateId?: string,
  bgStateId?: string,
): void {
  grid.setText(x, y, text, style, { stateId, bgStateId })
}

function setTransitionLabel(
  grid: StateGrid,
  x: number,
  y: number,
  lines: readonly string[],
  style: StateCellStyle,
): void {
  lines.forEach((line, index) => setText(grid, x, y + index, line, style))
}

function drawBox(
  grid: StateGrid,
  state: StateDiagramState,
  bounds: BoxBounds,
  lines: string[],
  active: boolean,
  borderStyle: BorderStyle,
): void {
  if (isHiddenCompositeMarker(state)) return

  if (state.kind !== "state") {
    setCell(grid, bounds.left, bounds.top, state.label, active ? "activeState" : state.kind, state.id)
    return
  }
  const style: StateCellStyle = active ? "activeState" : "state"
  fillBoxInterior(grid, bounds, style, state.id)
  drawStateFrame(grid, bounds, BorderChars[borderStyle], style, state.id)
  lines.forEach((line, index) => {
    setStateText(grid, bounds, bounds.left + 2, bounds.top + 1 + index, line, style, state.id)
  })
}

function stateColorKeyForCell(bounds: BoxBounds, stateId: string, x: number, y: number, border = false): string {
  return stateDiagramStateColorKey(stateId, diagramRadialCellColorLevel(bounds, x, y, border))
}

function fillBoxInterior(grid: StateGrid, bounds: BoxBounds, style: StateCellStyle, stateId: string): void {
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
      const colorKey = stateColorKeyForCell(bounds, stateId, x, y)
      setCell(grid, x, y, " ", style, colorKey, colorKey)
    }
  }
}

function drawStateFrame(
  grid: StateGrid,
  bounds: BoxBounds,
  chars: BorderCharacters,
  style: StateCellStyle,
  stateId: string,
): void {
  const setBorderCell = (x: number, y: number, char: string) => {
    setCell(grid, x, y, char, style, stateColorKeyForCell(bounds, stateId, x, y, true))
  }

  drawDiagramFrame(bounds, chars, setBorderCell)
}

function setStateText(
  grid: StateGrid,
  bounds: BoxBounds,
  x: number,
  y: number,
  text: string,
  style: StateCellStyle,
  stateId: string,
): void {
  grid.setText(x, y, text, style, (cellX, cellY) => {
    const colorKey = stateColorKeyForCell(bounds, stateId, cellX, cellY)
    return { stateId: colorKey, bgStateId: colorKey }
  })
}

function drawContainerFrame(
  grid: StateGrid,
  bounds: BoxBounds,
  label: string,
  chars: BorderCharacters,
  style: StateCellStyle,
  stateId?: string,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) => setCell(grid, x, y, char, style, stateId))
  if (label) setText(grid, bounds.left + 2, bounds.top, ` ${label} `, style, stateId)
}

function drawHorizontalNoteConnector(grid: StateGrid, fromX: number, toX: number, y: number, char: string): void {
  const step = fromX <= toX ? 1 : -1
  for (let x = fromX; step === 1 ? x <= toX : x >= toX; x += step) {
    setCell(grid, x, y, char, "noteConnector")
  }
}

function drawNote(grid: StateGrid, bounds: StateNoteBounds, target: BoxBounds): void {
  const chars = BorderChars.double
  const connectorChars = BorderChars.double
  const noteX = bounds.note.position === "right" ? bounds.left - 1 : bounds.left + bounds.width
  const targetX = bounds.note.position === "right" ? target.left + target.width : target.left - 1
  const targetBottom = target.top + target.height - 1
  const noteBottom = bounds.top + bounds.height - 1
  const noteAbove = noteBottom < target.top
  const noteBelow = bounds.top > targetBottom
  let connectorY: number

  if (noteAbove || noteBelow) {
    const targetY = noteAbove ? target.top - 1 : targetBottom + 1
    connectorY = bounds.centerY
    const verticalStep = targetY <= connectorY ? 1 : -1

    for (let y = targetY; verticalStep === 1 ? y <= connectorY : y >= connectorY; y += verticalStep) {
      setCell(grid, targetX, y, connectorChars.vertical, "noteConnector")
    }

    drawHorizontalNoteConnector(grid, targetX, noteX, connectorY, connectorChars.horizontal)
    const connectorTurnsRight = targetX <= noteX
    const corner = noteAbove
      ? connectorTurnsRight
        ? connectorChars.topLeft
        : connectorChars.topRight
      : connectorTurnsRight
        ? connectorChars.bottomLeft
        : connectorChars.bottomRight
    setCell(grid, targetX, connectorY, corner, "noteConnector")
  } else {
    connectorY = Math.max(bounds.top + 1, Math.min(target.centerY, bounds.top + bounds.height - 2))
    drawHorizontalNoteConnector(grid, targetX, noteX, connectorY, connectorChars.horizontal)
  }

  drawContainerFrame(grid, bounds, "", chars, "noteBorder")
  setCell(
    grid,
    bounds.note.position === "right" ? bounds.left : bounds.left + bounds.width - 1,
    connectorY,
    bounds.note.position === "right" ? chars.rightT : chars.leftT,
    "noteBorder",
  )
  bounds.lines.forEach((line, index) => setText(grid, bounds.left + 2, bounds.top + 1 + index, line, "noteText"))
}

function transitionLineStyle(active: boolean): StateCellStyle {
  return active ? "activeTransition" : "transition"
}

function transitionLabelStyle(active: boolean): StateCellStyle {
  return active ? "activeTransition" : "label"
}

function transitionFadeCellStyle(context: TransitionDrawContext, distance: number): StateCellStyle {
  return stateTransitionFadeStyle(context.fadeSource, context.active, distance, context.fadeFromSource)
}

function drawTransitionRenderPlan(
  grid: StateGrid,
  plan: StateTransitionRenderPlan,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  context: TransitionDrawContext,
): void {
  const lineStyle = transitionLineStyle(context.active)
  for (const cell of plan.cells) {
    const char = cell.arrowDirection ? diagramArrowHead(cell.arrowDirection, arrowHeadStyle) : cell.char
    const style = cell.fadeDistance === undefined ? lineStyle : transitionFadeCellStyle(context, cell.fadeDistance)
    setCell(grid, cell.x, cell.y, char, style, cell.fadeDistance === undefined ? undefined : context.sourceStateId)
  }
  if (plan.label) {
    setTransitionLabel(grid, plan.label.x, plan.label.y, plan.label.lines, transitionLabelStyle(context.active))
  }
}

function drawTransitionJunctionPlans(
  grid: StateGrid,
  diagram: StateDiagram,
  bounds: Map<string, BoxBounds>,
  renderPlans: readonly StateTransitionRenderPlan[],
  activeState: string | undefined,
  activeTransitions: readonly StateDiagramActiveTransition[],
): void {
  for (const plan of createStateTransitionJunctionPlans(diagram, bounds, renderPlans)) {
    const active = plan.transitions.some((transition) => isActiveTransition(transition, activeTransitions))
    const style =
      plan.state.id === activeState
        ? "activeState"
        : active
          ? "activeTransition"
          : plan.kind === "choice"
            ? "choice"
            : "transition"
    setCell(grid, plan.bounds.left, plan.bounds.top, diagramLineGlyph(plan.connections, "rounded"), style)
  }
}

function transitionFadeSource(
  statesById: Map<string, StateDiagramState>,
  transition: StateDiagramTransition,
  activeState: string | undefined,
): FadeSourceStyle {
  if (transition.from === activeState) return "activeState"
  const source = statesById.get(transition.from)
  if (isHiddenCompositeMarker(source)) return "composite"
  if (source?.kind === "start") return "start"
  if (source?.kind === "end") return "end"
  if (source?.kind === "choice") return "choice"
  return "state"
}

export function drawStateDiagramGrid(sourceDiagram: StateDiagram, options: StateDiagramRenderOptions = {}): StateGrid {
  const directedDiagram = options.direction ? { ...sourceDiagram, direction: options.direction } : sourceDiagram
  const diagram = prepareVisibleStateDiagram(directedDiagram)
  const borderStyle = options.borderStyle ?? DEFAULT_STATE_BORDER_STYLE
  const arrowHeadStyle = options.arrowHeadStyle ?? DEFAULT_STATE_ARROW_HEAD_STYLE
  const minStateGap = normalizeStateMinStateGap(options.minStateGap)
  const activeTransitions = normalizeActiveTransitions(options.activeTransition)
  const { bounds, sizes, compositeBounds, noteBounds } = createStateDiagramLayout(diagram, {
    minStateGap,
  })
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  let allBounds = [...bounds.values(), ...noteBounds]
  let maxY = Math.max(0, ...allBounds.map((bound) => bound.top + bound.height))
  let feedbackLaneY = maxY + 3
  let feedbackTopY = Math.min(0, ...allBounds.map((bound) => bound.top)) - 3
  expandCompositeBoundsForFeedback(diagram, bounds, compositeBounds, feedbackLaneY)
  let transitionPlans = createStateTransitionRenderPlans(diagram, bounds, feedbackLaneY, feedbackTopY)
  const transitionTop = Math.min(
    0,
    ...transitionPlans.flatMap((plan) => [...plan.cells.map((cell) => cell.y), ...(plan.label ? [plan.label.y] : [])]),
  )
  if (transitionTop < 0) {
    const dy = -transitionTop
    for (const bound of new Set([...bounds.values(), ...noteBounds])) {
      bound.top += dy
      bound.centerY += dy
    }
    feedbackLaneY += dy
    feedbackTopY += dy
    transitionPlans = createStateTransitionRenderPlans(diagram, bounds, feedbackLaneY, feedbackTopY)
  }
  expandCompositeBoundsForInternalTransitions(diagram, compositeBounds, transitionPlans)
  const contentTop = Math.min(
    0,
    ...[...bounds.values(), ...noteBounds].map((bound) => bound.top),
    ...transitionPlans.flatMap((plan) => [...plan.cells.map((cell) => cell.y), ...(plan.label ? [plan.label.y] : [])]),
  )
  if (contentTop < 0) {
    const dy = -contentTop
    for (const bound of new Set([...bounds.values(), ...noteBounds])) {
      bound.top += dy
      bound.centerY += dy
    }
    transitionPlans = translateTransitionPlans(transitionPlans, dy)
  }
  allBounds = [...bounds.values(), ...noteBounds]
  const maxX = Math.max(0, ...allBounds.map((bound) => bound.left + bound.width))
  maxY = Math.max(0, ...allBounds.map((bound) => bound.top + bound.height))
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
    drawContainerFrame(
      grid,
      bound,
      composite.label,
      BorderChars[borderStyle],
      options.activeState === composite.id ? "activeState" : "composite",
    )
  }

  for (const state of diagram.states) {
    const bound = bounds.get(state.id)
    const size = sizes.get(state.id)
    if (!bound || !size) continue
    drawBox(grid, state, bound, size.lines, options.activeState === state.id, borderStyle)
  }

  for (const plan of transitionPlans) {
    const transition = plan.route.transition
    const fadeSource = transitionFadeSource(statesById, transition, options.activeState)
    const activeIndex = activeTransitionIndex(transition, activeTransitions)
    const active = activeIndex !== -1
    const fadeFromSource = activeIndex <= 0
    const drawContext: TransitionDrawContext = {
      fadeSource,
      active,
      fadeFromSource,
      sourceStateId: transition.from,
    }
    drawTransitionRenderPlan(grid, plan, arrowHeadStyle, drawContext)
  }

  drawTransitionJunctionPlans(grid, diagram, bounds, transitionPlans, options.activeState, activeTransitions)

  for (const noteBound of noteBounds) {
    const target = bounds.get(noteBound.note.target)
    if (target) drawNote(grid, noteBound, target)
  }

  return grid
}
