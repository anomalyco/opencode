import type { StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridStyledText } from "../core/render-grid.js"
import { sequenceStyleBackgroundColor, sequenceStyleColor, type SequenceStyleColors } from "./style.js"
import type { SequenceCellStyle } from "./types.js"

export type SequenceGrid = DiagramCanvas<SequenceCellStyle>

export function renderSequenceGridText(grid: SequenceGrid): string {
  return grid.toString()
}

export function renderSequenceGridStyledText(
  grid: SequenceGrid,
  colors: Parameters<typeof sequenceStyleColor>[1],
): StyledText {
  return renderDiagramGridStyledText(
    grid,
    (run) => sequenceStyleColor(run.style, colors),
    (run) => sequenceStyleBackgroundColor(run.style, colors as Required<SequenceStyleColors>),
  )
}
