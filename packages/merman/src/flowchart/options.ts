import type { BorderStyle } from "@opentui/core"
import type { FlowchartDirection } from "./types.js"

export interface FlowchartDiagramRenderOptions {
  compact?: boolean
  direction?: FlowchartDirection
  borderStyle?: BorderStyle
  minNodeGap?: number
  minRankGap?: number
  /** Target rendered width. Oversized horizontal layouts fold vertically and broad vertical ranks wrap. */
  layoutMaxWidth?: number
}
