import { RGBA } from "@opentui/core"
import { blendColor, numberedStyleKeys, rgba, type DiagramRgb } from "../core/color/style.js"
import type { TimelineBaseCellStyle, TimelineCellStyle } from "./types.js"

const DEFAULT_THEME_RGB = {
  title: [228, 239, 232],
  section: [154, 184, 169],
  period: [230, 177, 126],
  spine: [111, 138, 126],
  event: [134, 225, 200],
} as const satisfies Record<TimelineBaseCellStyle, DiagramRgb>

export type TimelineStyleColors = Required<Record<TimelineCellStyle, RGBA>>
export const TIMELINE_SECTION_FADE_STYLES = numberedStyleKeys("sectionFade", [1, 2, 3] as const)
export const TIMELINE_PERIOD_FADE_STYLES = numberedStyleKeys("periodFade", [1, 2, 3] as const)

export function resolveTimelineStyleColors(
  colors: Partial<Record<TimelineBaseCellStyle, RGBA | undefined>> = {},
): TimelineStyleColors {
  const section = colors.section ?? rgba(DEFAULT_THEME_RGB.section)
  const period = colors.period ?? rgba(DEFAULT_THEME_RGB.period)
  const spine = colors.spine ?? rgba(DEFAULT_THEME_RGB.spine)
  return {
    title: colors.title ?? rgba(DEFAULT_THEME_RGB.title),
    section,
    period,
    spine,
    event: colors.event ?? rgba(DEFAULT_THEME_RGB.event),
    sectionFade1: blendColor(section, spine, 0.5),
    sectionFade2: blendColor(section, spine, 0.67),
    sectionFade3: blendColor(section, spine, 0.83),
    periodFade1: blendColor(period, spine, 0.5),
    periodFade2: blendColor(period, spine, 0.67),
    periodFade3: blendColor(period, spine, 0.83),
  }
}
