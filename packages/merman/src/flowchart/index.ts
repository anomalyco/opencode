import { renderFlowchartDiagram, renderFlowchartDiagramAnsi } from "./render.js"
import type { FlowchartDiagramAnsiOptions, FlowchartDiagramRenderOptions } from "./options.js"

export type {
  FlowchartDiagram as Diagram,
  FlowchartActiveEdgeSelection as ActiveEdgeSelection,
  FlowchartDirection as Direction,
  FlowchartEdge as Edge,
  FlowchartEdgeDirection as EdgeDirection,
  FlowchartEdgeRoute as EdgeRoute,
  FlowchartNode as Node,
  FlowchartNodeBounds as NodeBounds,
  FlowchartNodeShape as NodeShape,
  FlowchartPoint as Point,
  FlowchartSubgraph as Subgraph,
  FlowchartSubgraphBounds as SubgraphBounds,
} from "./types.js"
export type {
  FlowchartDiagramAnsiOptions as AnsiRenderOptions,
  FlowchartDiagramOptions as RenderableOptions,
  FlowchartDiagramRenderOptions as PlainRenderOptions,
} from "./options.js"
export type { FlowchartDiagramAnsiTheme as Theme, FlowchartNodeColors as NodeColors } from "./style.js"
export { flowchartNodeColorKey as nodeColorKey } from "./style.js"
export { isMermaidFlowchartDiagram as is, parseMermaidFlowchartDiagram as parse } from "./parser.js"
export { FlowchartDiagramRenderable as Renderable } from "./renderable.js"

export interface RenderOptions extends FlowchartDiagramAnsiOptions {
  /** Emit ANSI color escapes. Default: `true`. Pass `false` for plain text. */
  color?: boolean
}

/**
 * Render a Mermaid flowchart string for the terminal.
 *
 * Defaults to ANSI-colored output. Pass `{ color: false }` for plain text.
 */
export function render(content: string, options: RenderOptions = {}): string {
  const { color = true, ...rest } = options
  return color
    ? renderFlowchartDiagramAnsi(content, rest)
    : renderFlowchartDiagram(content, rest as FlowchartDiagramRenderOptions)
}
