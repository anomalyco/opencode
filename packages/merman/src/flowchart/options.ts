import type { BorderStyle, ColorInput, TextBufferOptions } from "@opentui/core"
import type { FlowchartDiagramAnsiTheme, FlowchartNodeColors } from "./style.js"
import type { FlowchartActiveEdgeSelection, FlowchartDirection } from "./types.js"

export interface FlowchartDiagramRenderOptions {
  compact?: boolean
  direction?: FlowchartDirection
  borderStyle?: BorderStyle
  minNodeGap?: number
  minRankGap?: number
  /** Fold oversized horizontal layouts vertically when their rendered width exceeds this limit. */
  layoutMaxWidth?: number
  activeNode?: string
  activeEdge?: FlowchartActiveEdgeSelection
}

export interface FlowchartDiagramAnsiOptions extends FlowchartDiagramRenderOptions {
  theme?: FlowchartDiagramAnsiTheme
}

export interface FlowchartDiagramOptions extends TextBufferOptions, FlowchartDiagramRenderOptions {
  content?: string
  nodeColor?: ColorInput
  nodeColors?: FlowchartNodeColors
  nodeBgColors?: FlowchartNodeColors
  databaseColor?: ColorInput
  edgeColor?: ColorInput
  activeNodeColor?: ColorInput
  activeEdgeColor?: ColorInput
  labelColor?: ColorInput
  groupColor?: ColorInput
}
