import { drawGanttDiagramGrid } from "./drawing.js"
import { parseMermaidGanttDiagram } from "./parser.js"
import { renderGanttGridText } from "./render-grid.js"
import type { GanttDiagramRenderOptions } from "./types.js"

export function renderGanttDiagram(content: string, options: GanttDiagramRenderOptions = {}): string {
  return renderGanttGridText(drawGanttDiagramGrid(parseMermaidGanttDiagram(content), options))
}
