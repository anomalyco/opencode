import { RGBA } from "@opentui/core"
import { createColorRampTheme, DIAGRAM_FADE_STEPS, numberedStyleKeys, type DiagramRgb } from "../core/color/style.js"
import type { BaseStateCellStyle, FadeSourceStyle, StateCellStyle, TransitionFadeStyle } from "./types.js"

const DEFAULT_THEME_RGB = {
  state: [228, 239, 232],
  composite: [111, 138, 126],
  transition: [134, 225, 200],
  label: [134, 225, 200],
  noteBorder: [141, 169, 155],
  noteText: [215, 229, 221],
  noteConnector: [141, 169, 155],
  start: [134, 225, 200],
  end: [230, 177, 126],
  choice: [134, 225, 200],
} as const satisfies Record<BaseStateCellStyle, DiagramRgb>
const FADE_STEPS = DIAGRAM_FADE_STEPS
const FADE_SOURCE_STYLES = [
  "state",
  "composite",
  "start",
  "end",
  "choice",
] as const satisfies readonly FadeSourceStyle[]
const TRANSITION_FADE_STYLES = createTransitionFadeStyles()
const TRANSITION_FADE_STYLES_SET = new Set<StateCellStyle>(Object.values(TRANSITION_FADE_STYLES).flat())
export type StateStyleColors = Required<Record<StateCellStyle, RGBA>>

export function resolveStateStyleColors(
  colors: Partial<Record<BaseStateCellStyle, RGBA | undefined>> = {},
): StateStyleColors {
  const resolved = {
    state: colors.state ?? RGBA.fromInts(...DEFAULT_THEME_RGB.state, 255),
    composite: colors.composite ?? RGBA.fromInts(...DEFAULT_THEME_RGB.composite, 255),
    transition: colors.transition ?? RGBA.fromInts(...DEFAULT_THEME_RGB.transition, 255),
    label: colors.label ?? RGBA.fromInts(...DEFAULT_THEME_RGB.label, 255),
    noteBorder: colors.noteBorder ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteBorder, 255),
    noteText: colors.noteText ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteText, 255),
    noteConnector: colors.noteConnector ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteConnector, 255),
    start: colors.start ?? RGBA.fromInts(...DEFAULT_THEME_RGB.start, 255),
    end: colors.end ?? RGBA.fromInts(...DEFAULT_THEME_RGB.end, 255),
    choice: colors.choice ?? RGBA.fromInts(...DEFAULT_THEME_RGB.choice, 255),
  }
  return {
    ...resolved,
    ...createColorRampTheme(TRANSITION_FADE_STYLES.state, resolved.state, resolved.transition),
    ...createColorRampTheme(TRANSITION_FADE_STYLES.composite, resolved.composite, resolved.transition),
    ...createColorRampTheme(TRANSITION_FADE_STYLES.start, resolved.start, resolved.transition),
    ...createColorRampTheme(TRANSITION_FADE_STYLES.end, resolved.end, resolved.transition),
    ...createColorRampTheme(TRANSITION_FADE_STYLES.choice, resolved.choice, resolved.transition),
  }
}

function createTransitionFadeStyles(): Record<FadeSourceStyle, readonly TransitionFadeStyle[]> {
  const styles = {} as Record<FadeSourceStyle, readonly TransitionFadeStyle[]>
  for (const source of FADE_SOURCE_STYLES) {
    styles[source] = numberedStyleKeys(`${source}TransitionFade`, FADE_STEPS)
  }
  return styles
}

export function isStateTransitionFadeStyle(style: StateCellStyle | undefined): boolean {
  return style ? TRANSITION_FADE_STYLES_SET.has(style) : false
}

export function stateTransitionFadeStyle(source: FadeSourceStyle, distance: number): StateCellStyle {
  if (distance <= 0) return `${source}TransitionFade1` as TransitionFadeStyle
  if (distance >= FADE_STEPS.length) return "transition"
  return `${source}TransitionFade${distance + 1}` as TransitionFadeStyle
}
