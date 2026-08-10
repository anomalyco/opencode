import { BorderChars, type BorderStyle } from "@opentui/core"
import { DiagramCanvas } from "../core/canvas.js"
import { diagramTextWidth } from "../core/text.js"
import { DEFAULT_FRAGMENT_BORDER_STYLE, SEQUENCE_LIFELINE_FADE_STEPS } from "./options.js"
import {
  createSequencePlacementPlan,
  type SequenceGroupPlacement,
  type SequenceHorizontalBounds,
  type SequenceStepPlacement,
} from "./placement.js"
import type { SequenceGrid } from "./render-grid.js"
import { SEQUENCE_FADE_STEPS as FADE_STEPS } from "./style.js"
import type {
  MessageStyle,
  SequenceArrowHead,
  SequenceCellStyle,
  SequenceDiagram,
  SequenceDiagramRenderOptions,
} from "./types.js"

const SEQUENCE_BORDER = BorderChars.rounded

function centeredStart(center: number, text: string): number {
  return center - Math.floor(diagramTextWidth(text) / 2)
}

function arrowHeadChar(head: SequenceArrowHead | undefined, direction: 1 | -1): string {
  switch (head) {
    case "open":
      return direction === 1 ? ">" : "<"
    case "cross":
      return "✕"
    case "async":
      return direction === 1 ? ")" : "("
    default:
      return direction === 1 ? "►" : "◄"
  }
}

function createGrid(width: number, height: number): SequenceGrid {
  return new DiagramCanvas(width, height)
}

function setCell(grid: SequenceGrid, x: number, y: number, char: string, style?: SequenceCellStyle): void {
  grid.setCell(x, y, char, style)
}

function setText(grid: SequenceGrid, x: number, y: number, text: string, style?: SequenceCellStyle): void {
  grid.setText(Math.max(0, x), y, text, style)
}

function setArrowDepartureFade(
  grid: SequenceGrid,
  x: number,
  y: number,
  direction: 1 | -1,
  style: SequenceCellStyle,
): void {
  setCell(
    grid,
    x,
    y,
    direction === 1 ? SEQUENCE_BORDER.leftT : SEQUENCE_BORDER.rightT,
    `${style}Fade1` as SequenceCellStyle,
  )
  for (let step = 2; step <= 5; step++) {
    setCell(grid, x + direction * (step - 1), y, SEQUENCE_BORDER.horizontal, `${style}Fade${step}` as SequenceCellStyle)
  }
}

function groupVerticalChar(existing: string | undefined): string | undefined {
  switch (existing) {
    case undefined:
    case " ":
      return SEQUENCE_BORDER.vertical
    case SEQUENCE_BORDER.vertical:
      return SEQUENCE_BORDER.vertical
    default:
      return undefined
  }
}

function setGroupVerticalCell(grid: SequenceGrid, x: number, y: number): void {
  const existing = grid.getCell(x, y)?.char
  const char = groupVerticalChar(existing)
  if (char) setCell(grid, x, y, char, "group")
}

function renderParticipantGroups(
  grid: SequenceGrid,
  groupBounds: readonly SequenceGroupPlacement[],
  bottomY: number,
): void {
  for (const bounds of groupBounds) {
    for (let x = bounds.leftX; x <= bounds.rightX; x++) {
      setCell(grid, x, 0, SEQUENCE_BORDER.horizontal, "group")
      setCell(grid, x, bottomY, SEQUENCE_BORDER.horizontal, "group")
    }

    setCell(grid, bounds.leftX, 0, SEQUENCE_BORDER.topLeft, "group")
    setCell(grid, bounds.rightX, 0, SEQUENCE_BORDER.topRight, "group")
    setCell(grid, bounds.leftX, bottomY, SEQUENCE_BORDER.bottomLeft, "group")
    setCell(grid, bounds.rightX, bottomY, SEQUENCE_BORDER.bottomRight, "group")

    for (let y = 1; y < bottomY; y++) {
      setGroupVerticalCell(grid, bounds.leftX, y)
      setGroupVerticalCell(grid, bounds.rightX, y)
    }

    if (bounds.labelText) {
      setText(grid, bounds.leftX + 2, 0, bounds.labelText, "group")
    }
  }
}

function drawFragmentWalls(
  grid: SequenceGrid,
  bounds: SequenceHorizontalBounds,
  startY: number,
  endY: number,
  borderStyle: BorderStyle,
): void {
  if (endY < startY) return
  const border = BorderChars[borderStyle]

  for (let y = startY; y <= endY; y++) {
    setCell(grid, bounds.leftX, y, border.vertical, "fragment")
    setCell(grid, bounds.rightX, y, border.vertical, "fragment")
  }
}

function renderFragment(
  grid: SequenceGrid,
  placement: Extract<SequenceStepPlacement, { type: "fragment" }>,
  borderStyle: BorderStyle,
): void {
  const { bounds, fragment, labelText: label, y } = placement
  const border = BorderChars[borderStyle]
  const { leftX, rightX } = bounds

  const leftChar =
    fragment.kind === "alt" || fragment.kind === "loop"
      ? border.topLeft
      : fragment.kind === "else"
        ? border.leftT
        : border.bottomLeft
  const rightChar =
    fragment.kind === "alt" || fragment.kind === "loop"
      ? border.topRight
      : fragment.kind === "else"
        ? border.rightT
        : border.bottomRight

  for (let x = leftX; x <= rightX; x++) {
    setCell(grid, x, y, border.horizontal, "fragment")
  }

  setCell(grid, leftX, y, leftChar, "fragment")
  setCell(grid, rightX, y, rightChar, "fragment")
  if (label) {
    setText(grid, leftX + 2, y, label, "fragmentLabel")
  }
}

function renderSelfMessage(
  grid: SequenceGrid,
  placement: Extract<SequenceStepPlacement, { type: "selfMessage" }>,
  style: MessageStyle,
): void {
  const { centerX, rightX, topY: topRow, bottomY: bottomRow, labelLines, message } = placement

  setArrowDepartureFade(grid, centerX, topRow, 1, style)
  for (let x = centerX + FADE_STEPS.length; x < rightX; x++) {
    setCell(grid, x, topRow, SEQUENCE_BORDER.horizontal, style)
  }
  setCell(grid, rightX, topRow, SEQUENCE_BORDER.topRight, style)

  for (let lineIndex = 0; lineIndex < labelLines.length; lineIndex++) {
    const y = topRow + lineIndex + 1
    setCell(grid, centerX, y, SEQUENCE_BORDER.vertical, "lifeline")
    setText(grid, centerX + 2, y, labelLines[lineIndex]!, style)
    setCell(grid, rightX, y, SEQUENCE_BORDER.vertical, style)
  }

  for (let x = centerX + 1; x < rightX; x++) {
    setCell(grid, x, bottomRow, SEQUENCE_BORDER.horizontal, style)
  }
  const headX = message.head === undefined ? centerX : centerX + 1
  setCell(grid, headX, bottomRow, arrowHeadChar(message.head, -1), style)
  setCell(grid, rightX, bottomRow, SEQUENCE_BORDER.bottomRight, style)
}

function renderNote(grid: SequenceGrid, placement: Extract<SequenceStepPlacement, { type: "note" }>): void {
  placement.textLines.forEach((line, index) =>
    setText(grid, placement.textX, placement.textY + index, line, "noteBadge"),
  )
}

export function drawSequenceDiagramGrid(
  diagram: SequenceDiagram,
  options: SequenceDiagramRenderOptions = {},
): SequenceGrid {
  const plan = createSequencePlacementPlan(diagram, options)
  if (plan.width === 0 || plan.height === 0) return createGrid(0, 0)
  const fragmentBorderStyle = options.fragmentBorderStyle ?? DEFAULT_FRAGMENT_BORDER_STYLE
  const grid = createGrid(plan.width, plan.height)

  if (plan.groups.length > 0) renderParticipantGroups(grid, plan.groups, plan.height - 1)

  for (const placement of plan.participants) {
    const { centerX: center, headerLeftX, headerRightX, labelLines } = placement
    const { participantHeaderTopY, participantHeaderY, participantRuleY, lifelineStartY, lifelineEndY } = plan.rows

    if (options.compact) {
      labelLines.forEach((line, index) =>
        setText(grid, centeredStart(center, line), participantHeaderY + index, line, "participant"),
      )
    } else {
      labelLines.forEach((line, index) =>
        setText(grid, centeredStart(center, line), participantHeaderTopY + index, line, "participant"),
      )
      for (let x = headerLeftX; x <= headerRightX; x++) {
        setCell(grid, x, participantRuleY, SEQUENCE_BORDER.horizontal, "participant")
      }
      setCell(grid, center, participantRuleY, SEQUENCE_BORDER.topT, "participant")
    }

    for (let y = lifelineStartY; y <= lifelineEndY; y++) {
      const distance = y - lifelineStartY
      const fadeDistance = y - (lifelineEndY - SEQUENCE_LIFELINE_FADE_STEPS.length + 1)
      const style =
        fadeDistance >= 0
          ? (`lifelineFade${fadeDistance + 1}` as SequenceCellStyle)
          : !options.compact && distance < 3
            ? (`lifelineRamp${distance + 1}` as SequenceCellStyle)
            : "lifeline"
      setCell(grid, center, y, SEQUENCE_BORDER.vertical, style)
    }
  }

  for (const placement of plan.steps) {
    if (placement.type === "note") {
      renderNote(grid, placement)
      continue
    }

    if (placement.type === "fragment") {
      if (placement.wallsBefore) {
        drawFragmentWalls(
          grid,
          placement.wallsBefore.bounds,
          placement.wallsBefore.startY,
          placement.wallsBefore.endY,
          fragmentBorderStyle,
        )
      }
      renderFragment(grid, placement, fragmentBorderStyle)
      continue
    }

    const message = placement.message
    const messageStyle: MessageStyle = message.style === "dashed" ? "response" : "request"

    if (placement.type === "selfMessage") {
      renderSelfMessage(grid, placement, messageStyle)
      continue
    }

    if (!placement.inlineLabel) {
      for (let lineIndex = 0; lineIndex < placement.labelLines.length; lineIndex++) {
        setText(grid, placement.labelX, placement.labelY + lineIndex, placement.labelLines[lineIndex]!, messageStyle)
      }
    }

    for (let x = placement.leftX + 1; x < placement.rightX; x++) {
      setCell(grid, x, placement.arrowY, SEQUENCE_BORDER.horizontal, messageStyle)
    }

    setArrowDepartureFade(grid, placement.fromX, placement.arrowY, placement.direction, messageStyle)
    setCell(grid, placement.headX, placement.arrowY, arrowHeadChar(message.head, placement.direction), messageStyle)
    if (placement.inlineLabel) setText(grid, placement.labelX, placement.labelY, placement.inlineLabel, messageStyle)
  }

  for (const activation of plan.activations) {
    for (let y = activation.startY; y <= activation.endY; y++) {
      if (grid.getCell(activation.centerX, y)?.char === SEQUENCE_BORDER.vertical) {
        setCell(grid, activation.centerX, y, "┃", "lifeline")
      }
    }
  }

  return grid
}
