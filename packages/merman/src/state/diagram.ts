import { drawStateDiagramGrid } from "./drawing.js"
import { parseMermaidStateDiagram } from "./parser.js"
import { renderStateGridText } from "./render-grid.js"
import type { StateDiagramRenderOptions } from "./types.js"

export function renderStateDiagram(content: string, options: StateDiagramRenderOptions = {}): string {
  return renderStateGridText(drawStateDiagramGrid(parseMermaidStateDiagram(content), options))
}
