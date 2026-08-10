import { RGBA } from "@opentui/core"
import {
  blendColor,
  createColorRampTheme,
  DIAGRAM_FADE_STEPS,
  numberedStyleKeys,
  rgba,
  type DiagramRgb,
} from "../core/color/style.js"
import { SEQUENCE_LIFELINE_FADE_STEPS } from "./options.js"
import type { FadeStyle, LifelineFadeStyle, LifelineRampStyle, SequenceCellStyle } from "./types.js"

export interface SequenceStyleColors {
  participant?: RGBA
  lifeline?: RGBA
  lifelineEnd?: RGBA
  group?: RGBA
  request?: RGBA
  response?: RGBA
  fragment?: RGBA
  fragmentLabelBg?: RGBA
  note?: RGBA
  noteBg?: RGBA
}

export const SEQUENCE_FADE_STEPS = DIAGRAM_FADE_STEPS
const LIFELINE_RAMP_STYLES = [
  "lifelineRamp1",
  "lifelineRamp2",
  "lifelineRamp3",
] as const satisfies readonly LifelineRampStyle[]

const DEFAULT_THEME_RGB = {
  participant: [228, 239, 232],
  lifeline: [111, 138, 126],
  lifelineEnd: [15, 23, 19],
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
): Required<SequenceStyleColors> & Record<FadeStyle | LifelineFadeStyle | LifelineRampStyle, RGBA> {
  const participant = colors.participant ?? rgba(DEFAULT_THEME_RGB.participant)
  const lifeline = colors.lifeline ?? rgba(DEFAULT_THEME_RGB.lifeline)
  const request = colors.request ?? rgba(DEFAULT_THEME_RGB.request)
  const response = colors.response ?? rgba(DEFAULT_THEME_RGB.response)
  const lifelineEnd = colors.lifelineEnd ?? rgba(DEFAULT_THEME_RGB.lifelineEnd)
  const lifelineFade = Object.fromEntries(
    SEQUENCE_LIFELINE_FADE_STEPS.map((step, index) => [
      `lifelineFade${step}`,
      blendColor(lifeline, lifelineEnd, index / (SEQUENCE_LIFELINE_FADE_STEPS.length - 1)),
    ]),
  ) as Record<LifelineFadeStyle, RGBA>
  return {
    participant,
    lifeline,
    lifelineEnd,
    group: colors.group ?? rgba(DEFAULT_THEME_RGB.group),
    request,
    response,
    fragment: colors.fragment ?? rgba(DEFAULT_THEME_RGB.fragment),
    fragmentLabelBg: colors.fragmentLabelBg ?? rgba(DEFAULT_THEME_RGB.fragmentLabelBg),
    note: colors.note ?? rgba(DEFAULT_THEME_RGB.noteFg),
    noteBg: colors.noteBg ?? rgba(DEFAULT_THEME_RGB.noteBg),
    ...createColorRampTheme(numberedStyleKeys("requestFade", SEQUENCE_FADE_STEPS), lifeline, request),
    ...createColorRampTheme(numberedStyleKeys("responseFade", SEQUENCE_FADE_STEPS), lifeline, response),
    ...createColorRampTheme(LIFELINE_RAMP_STYLES, participant, lifeline),
    ...lifelineFade,
  }
}

export function sequenceStyleColor(
  style: SequenceCellStyle | undefined,
  colors: Required<SequenceStyleColors> & Record<FadeStyle | LifelineFadeStyle | LifelineRampStyle, RGBA>,
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
