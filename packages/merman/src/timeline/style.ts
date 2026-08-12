import { RGBA } from "@opentui/core"
import { rgba, type DiagramRgb } from "../core/color/style.js"
import type { TimelineCellStyle } from "./types.js"

const DEFAULT_THEME_RGB = {
  title: [228, 239, 232],
  section: [154, 184, 169],
  period: [230, 177, 126],
  spine: [111, 138, 126],
  event: [134, 225, 200],
} as const satisfies Record<TimelineCellStyle, DiagramRgb>

export type TimelineStyleColors = Required<Record<TimelineCellStyle, RGBA>>

export function resolveTimelineStyleColors(
  colors: Partial<Record<TimelineCellStyle, RGBA | undefined>> = {},
): TimelineStyleColors {
  return {
    title: colors.title ?? rgba(DEFAULT_THEME_RGB.title),
    section: colors.section ?? rgba(DEFAULT_THEME_RGB.section),
    period: colors.period ?? rgba(DEFAULT_THEME_RGB.period),
    spine: colors.spine ?? rgba(DEFAULT_THEME_RGB.spine),
    event: colors.event ?? rgba(DEFAULT_THEME_RGB.event),
  }
}
