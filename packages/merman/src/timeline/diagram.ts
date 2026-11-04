import { drawTimelineDiagramGrid } from "./drawing.js"
import { parseMermaidTimelineDiagram } from "./parser.js"
import { renderTimelineGridText } from "./render-grid.js"
import type { TimelineDiagramRenderOptions } from "./types.js"

export function renderTimelineDiagram(content: string, options: TimelineDiagramRenderOptions = {}): string {
  return renderTimelineGridText(drawTimelineDiagramGrid(parseMermaidTimelineDiagram(content), options))
}
