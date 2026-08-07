import { drawSequenceDiagramGrid } from "./drawing.js"
import { parseMermaidSequenceDiagram } from "./parser.js"
import { renderSequenceGridAnsi, renderSequenceGridText } from "./render-grid.js"
import type { SequenceDiagramAnsiOptions, SequenceDiagramRenderOptions } from "./types.js"

export function renderSequenceDiagram(content: string, options: SequenceDiagramRenderOptions = {}): string {
  return renderSequenceGridText(drawSequenceDiagramGrid(parseMermaidSequenceDiagram(content), options))
}

export function renderSequenceDiagramAnsi(content: string, options: SequenceDiagramAnsiOptions = {}): string {
  return renderSequenceGridAnsi(drawSequenceDiagramGrid(parseMermaidSequenceDiagram(content), options), options.theme)
}
