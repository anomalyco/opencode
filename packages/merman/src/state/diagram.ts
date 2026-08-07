import { drawStateDiagramGrid } from "./drawing.js"
import { parseMermaidStateDiagram } from "./parser.js"
import { renderStateGridAnsi, renderStateGridText } from "./render-grid.js"
import type { StateDiagramAnsiOptions, StateDiagramRenderOptions } from "./types.js"

export function renderStateDiagram(content: string, options: StateDiagramRenderOptions = {}): string {
  return renderStateGridText(drawStateDiagramGrid(parseMermaidStateDiagram(content), options))
}

export function renderStateDiagramAnsi(content: string, options: StateDiagramAnsiOptions = {}): string {
  return renderStateGridAnsi(drawStateDiagramGrid(parseMermaidStateDiagram(content), options), options.theme)
}
