import type { StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridAnsi, renderDiagramGridStyledText } from "../core/render-grid.js"
import { resolveStateAnsiTheme, type StateStyleColors } from "./style.js"
import type { StateCellStyle, StateDiagramAnsiTheme } from "./types.js"

export type StateGrid = DiagramCanvas<StateCellStyle>

export function renderStateGridText(grid: StateGrid): string {
  return grid.toString({ trimBottom: true })
}

export function renderStateGridStyledText(grid: StateGrid, colors: StateStyleColors): StyledText {
  return renderDiagramGridStyledText(grid, (run) => (run.style ? colors[run.style] : undefined), undefined, {
    trimBottom: true,
  })
}

export function renderStateGridAnsi(grid: StateGrid, theme: StateDiagramAnsiTheme = {}): string {
  const resolved = resolveStateAnsiTheme(theme)
  return renderDiagramGridAnsi(grid, (run) => (run.style ? resolved[run.style] : undefined), {
    trimBottom: true,
  })
}
