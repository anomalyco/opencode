import { drawFlowchartDiagramGrid } from "./drawing.js"
import type { FlowchartDiagramRenderOptions } from "./options.js"
import { parseMermaidFlowchartDiagram } from "./parser.js"

export function renderFlowchartDiagram(content: string, options: FlowchartDiagramRenderOptions = {}): string {
  return drawFlowchartDiagramGrid(parseMermaidFlowchartDiagram(content), options).toString({
    trimTop: true,
    trimBottom: true,
  })
}
