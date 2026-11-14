import { drawClassDiagramGrid } from "./drawing.js"
import { parseMermaidClassDiagram } from "./parser.js"
import { renderClassGridText } from "./render-grid.js"
import type { ClassDiagramRenderOptions } from "./types.js"

export function renderClassDiagram(content: string, options: ClassDiagramRenderOptions = {}): string {
  return renderClassGridText(drawClassDiagramGrid(parseMermaidClassDiagram(content), options))
}
