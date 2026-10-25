import { drawSequenceDiagramGrid } from "./drawing.js"
import { parseMermaidSequenceDiagram } from "./parser.js"
import { renderSequenceGridText } from "./render-grid.js"
import type { SequenceDiagramRenderOptions } from "./types.js"

export function renderSequenceDiagram(content: string, options: SequenceDiagramRenderOptions = {}): string {
  return renderSequenceGridText(drawSequenceDiagramGrid(parseMermaidSequenceDiagram(content), options))
}
