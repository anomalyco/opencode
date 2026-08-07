import type { StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridAnsi, renderDiagramGridStyledText } from "../core/render-grid.js"
import {
  resolveSequenceAnsiTheme,
  sequenceStyleBackgroundColor,
  sequenceStyleColor,
  type SequenceStyleColors,
} from "./style.js"
import type { SequenceCellStyle, SequenceDiagramAnsiTheme } from "./types.js"

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

export function renderSequenceGridAnsi(grid: SequenceGrid, theme: SequenceDiagramAnsiTheme = {}): string {
  const resolvedTheme = resolveSequenceAnsiTheme(theme)
  return renderDiagramGridAnsi(grid, (run) => {
    if (run.style === "noteBadge") return resolvedTheme.note
    return run.style ? resolvedTheme[run.style] : undefined
  })
}
