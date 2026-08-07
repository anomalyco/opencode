import { drawFlowchartDiagramGrid } from "./drawing.js"
import type { FlowchartDiagramAnsiOptions, FlowchartDiagramRenderOptions } from "./options.js"
import { parseMermaidFlowchartDiagram } from "./parser.js"
import { renderGridAnsi } from "./style.js"

export function renderFlowchartDiagram(content: string, options: FlowchartDiagramRenderOptions = {}): string {
  return drawFlowchartDiagramGrid(parseMermaidFlowchartDiagram(content), options).toString({
    trimTop: true,
    trimBottom: true,
  })
}

export function renderFlowchartDiagramAnsi(content: string, options: FlowchartDiagramAnsiOptions = {}): string {
  return renderGridAnsi(drawFlowchartDiagramGrid(parseMermaidFlowchartDiagram(content), options), options.theme)
}
