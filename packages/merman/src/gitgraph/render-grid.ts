import type { StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridStyledText } from "../core/render-grid.js"
import type { GitGraphStyleColors } from "./style.js"
import type { GitGraphCellStyle } from "./types.js"

export type GitGraphGrid = DiagramCanvas<GitGraphCellStyle>

export function renderGitGraphGridText(grid: GitGraphGrid): string {
  return grid.toString({ trimBottom: true })
}

export function renderGitGraphGridStyledText(grid: GitGraphGrid, colors: GitGraphStyleColors): StyledText {
  return renderDiagramGridStyledText(grid, (run) => (run.style ? colors[run.style] : undefined), undefined, {
    trimBottom: true,
  })
}
