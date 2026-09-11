import type { StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridStyledText } from "../core/render-grid.js"
import type { GanttStyleColors } from "./style.js"
import type { GanttCellStyle } from "./types.js"

export type GanttGrid = DiagramCanvas<GanttCellStyle>

export function renderGanttGridText(grid: GanttGrid): string {
  return grid.toString({ trimBottom: true })
}

export function renderGanttGridStyledText(grid: GanttGrid, colors: GanttStyleColors): StyledText {
  return renderDiagramGridStyledText(grid, (run) => (run.style ? colors[run.style] : undefined), undefined, {
    trimBottom: true,
  })
}
