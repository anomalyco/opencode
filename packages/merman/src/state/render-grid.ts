import type { StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridStyledText } from "../core/render-grid.js"
import type { StateStyleColors } from "./style.js"
import type { StateCellStyle } from "./types.js"

export type StateGrid = DiagramCanvas<StateCellStyle>

export function renderStateGridText(grid: StateGrid): string {
  return grid.toString({ trimBottom: true })
}

export function renderStateGridStyledText(grid: StateGrid, colors: StateStyleColors): StyledText {
  return renderDiagramGridStyledText(grid, (run) => (run.style ? colors[run.style] : undefined), undefined, {
    trimBottom: true,
  })
}
