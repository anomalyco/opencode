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
  /**
   * Push nodes that belong to no group off any group frame that ranking placed them inside.
   * Off by default because it can widen layouts beyond `layoutMaxWidth`.
   */
  separateLooseNodes?: boolean
}
