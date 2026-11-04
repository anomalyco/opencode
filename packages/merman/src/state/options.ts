import type { BorderStyle } from "@opentui/core"
import type { StateDiagramArrowHeadStyle } from "./types.js"

export const DEFAULT_STATE_DIAGRAM_MIN_STATE_GAP = 5
export const DEFAULT_STATE_BORDER_STYLE = "rounded" satisfies BorderStyle
export const DEFAULT_STATE_ARROW_HEAD_STYLE = "filled" satisfies StateDiagramArrowHeadStyle

export function normalizeStateMinStateGap(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_STATE_DIAGRAM_MIN_STATE_GAP
  return Math.max(1, Math.trunc(value))
}
