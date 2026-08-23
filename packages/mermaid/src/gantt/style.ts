import { RGBA } from "@opentui/core"
import { rgba, type DiagramRgb } from "../core/color/style.js"
import type { GanttCellStyle } from "./types.js"

const DEFAULT_THEME_RGB = {
  title: [228, 239, 232],
  axis: [111, 138, 126],
  section: [154, 184, 169],
  task: [134, 225, 200],
  active: [134, 225, 200],
  critical: [230, 177, 126],
  done: [111, 138, 126],
  milestone: [198, 160, 246],
} as const satisfies Record<GanttCellStyle, DiagramRgb>

export type GanttStyleColors = Required<Record<GanttCellStyle, RGBA>>

export function resolveGanttStyleColors(
  colors: Partial<Record<GanttCellStyle, RGBA | undefined>> = {},
): GanttStyleColors {
  return {
    title: colors.title ?? rgba(DEFAULT_THEME_RGB.title),
    axis: colors.axis ?? rgba(DEFAULT_THEME_RGB.axis),
    section: colors.section ?? rgba(DEFAULT_THEME_RGB.section),
    task: colors.task ?? rgba(DEFAULT_THEME_RGB.task),
    active: colors.active ?? rgba(DEFAULT_THEME_RGB.active),
    critical: colors.critical ?? rgba(DEFAULT_THEME_RGB.critical),
    done: colors.done ?? rgba(DEFAULT_THEME_RGB.done),
    milestone: colors.milestone ?? rgba(DEFAULT_THEME_RGB.milestone),
  }
}
