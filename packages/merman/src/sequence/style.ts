import { RGBA } from "@opentui/core"
import { createColorRampTheme, DIAGRAM_FADE_STEPS, numberedStyleKeys, type DiagramRgb } from "../core/color/style.js"
import type { FadeStyle, SequenceCellStyle } from "./types.js"

export interface SequenceStyleColors {
  participant?: RGBA
  lifeline?: RGBA
  group?: RGBA
  request?: RGBA
  response?: RGBA
  fragment?: RGBA
  fragmentLabelBg?: RGBA
  note?: RGBA
  noteBg?: RGBA
}

export const SEQUENCE_FADE_STEPS = DIAGRAM_FADE_STEPS

const DEFAULT_THEME_RGB = {
  participant: [228, 239, 232],
  lifeline: [111, 138, 126],
  group: [76, 99, 89],
  request: [134, 225, 200],
  response: [230, 177, 126],
  fragment: [154, 184, 169],
  fragmentLabelBg: [28, 43, 36],
  noteFg: [215, 229, 221],
  noteBg: [36, 56, 47],
} as const satisfies Record<string, DiagramRgb>

export function resolveSequenceStyleColors(
  colors: SequenceStyleColors = {},
): Required<SequenceStyleColors> & Record<FadeStyle, RGBA> {
  const lifeline = colors.lifeline ?? RGBA.fromInts(...DEFAULT_THEME_RGB.lifeline, 255)
  const request = colors.request ?? RGBA.fromInts(...DEFAULT_THEME_RGB.request, 255)
  const response = colors.response ?? RGBA.fromInts(...DEFAULT_THEME_RGB.response, 255)
  return {
    participant: colors.participant ?? RGBA.fromInts(...DEFAULT_THEME_RGB.participant, 255),
    lifeline,
    group: colors.group ?? RGBA.fromInts(...DEFAULT_THEME_RGB.group, 255),
    request,
    response,
    fragment: colors.fragment ?? RGBA.fromInts(...DEFAULT_THEME_RGB.fragment, 255),
    fragmentLabelBg: colors.fragmentLabelBg ?? RGBA.fromInts(...DEFAULT_THEME_RGB.fragmentLabelBg, 255),
    note: colors.note ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteFg, 255),
    noteBg: colors.noteBg ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteBg, 255),
    ...createColorRampTheme(numberedStyleKeys("requestFade", SEQUENCE_FADE_STEPS), lifeline, request),
    ...createColorRampTheme(numberedStyleKeys("responseFade", SEQUENCE_FADE_STEPS), lifeline, response),
  }
}

export function sequenceStyleColor(
  style: SequenceCellStyle | undefined,
  colors: Required<SequenceStyleColors> & Record<FadeStyle, RGBA>,
): RGBA | undefined {
  if (style === "noteBadge") return colors.note
  if (style === "fragmentLabel") return colors.fragment
  return style ? colors[style] : undefined
}

export function sequenceStyleBackgroundColor(
  style: SequenceCellStyle | undefined,
  colors: Required<SequenceStyleColors>,
): RGBA | undefined {
  if (style === "note" || style === "noteBadge") return colors.noteBg
  if (style === "fragmentLabel") return colors.fragmentLabelBg
  return undefined
}
