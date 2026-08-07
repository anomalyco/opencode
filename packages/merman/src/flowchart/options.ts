import type { BorderStyle } from "@opentui/core"
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
