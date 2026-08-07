import type { BorderStyle } from "@opentui/core"
import type { FlowchartDiagramAnsiTheme } from "./style.js"
import type { FlowchartDirection } from "./types.js"

export interface FlowchartDiagramRenderOptions {
  compact?: boolean
  direction?: FlowchartDirection
  borderStyle?: BorderStyle
  minNodeGap?: number
  minRankGap?: number
  /** Fold oversized horizontal layouts vertically when their rendered width exceeds this limit. */
  layoutMaxWidth?: number
}

export interface FlowchartDiagramAnsiOptions extends FlowchartDiagramRenderOptions {
  theme?: FlowchartDiagramAnsiTheme
}
