import type { StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridStyledText } from "../core/render-grid.js"
import type { TimelineStyleColors } from "./style.js"
import type { TimelineCellStyle } from "./types.js"

export type TimelineGrid = DiagramCanvas<TimelineCellStyle>

export function renderTimelineGridText(grid: TimelineGrid): string {
  return grid.toString({ trimBottom: true })
}

export function renderTimelineGridStyledText(grid: TimelineGrid, colors: TimelineStyleColors): StyledText {
  return renderDiagramGridStyledText(grid, (run) => (run.style ? colors[run.style] : undefined), undefined, {
    trimBottom: true,
  })
}
