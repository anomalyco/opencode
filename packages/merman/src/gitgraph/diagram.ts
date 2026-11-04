import { drawGitGraphDiagramGrid } from "./drawing.js"
import { parseMermaidGitGraphDiagram } from "./parser.js"
import { renderGitGraphGridText } from "./render-grid.js"
import type { GitGraphDiagramRenderOptions } from "./types.js"

export function renderGitGraphDiagram(content: string, options: GitGraphDiagramRenderOptions = {}): string {
  return renderGitGraphGridText(drawGitGraphDiagramGrid(parseMermaidGitGraphDiagram(content), options))
}
