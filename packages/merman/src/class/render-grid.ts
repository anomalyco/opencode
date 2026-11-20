import type { StyledText } from "@opentui/core"
import { renderDiagramGridStyledTextByStyle } from "../core/render-grid.js"
import type { ClassGrid } from "./drawing.js"
import type { ClassStyleColors } from "./style.js"
import type { ClassCellStyle } from "./types.js"

export function renderClassGridText(grid: ClassGrid): string {
  return grid.toString({ trimTop: true, trimBottom: true })
}

export function renderClassGridStyledText(
  grid: ClassGrid,
  colors: ClassStyleColors,
  backgrounds?: Partial<Record<ClassCellStyle, ClassStyleColors[ClassCellStyle]>>,
): StyledText {
  return renderDiagramGridStyledTextByStyle(grid, colors, backgrounds, {
    key: (cell) => [cell.style, cell.attributes],
    attributes: (run) => run.cell.attributes,
    trimTop: true,
    trimBottom: true,
  })
}
