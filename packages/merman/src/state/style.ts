import type { RGBA } from "@opentui/core"
import { diagramCellColorKey, mappedDiagramColor } from "../core/color/map.js"
import {
  ansiFg,
  blendColor,
  createAnsiRampTheme,
  DIAGRAM_FADE_STEPS,
  numberedStyleKeys,
  rgba,
  type DiagramFadeStep,
  type DiagramRgb,
} from "../core/color/style.js"
import type {
  ActiveTransitionFadeStyle,
  BaseStateCellStyle,
  FadeSourceStyle,
  StateCellStyle,
  TransitionFadeStyle,
} from "./types.js"

export type StateStyleColors = Required<Record<BaseStateCellStyle, RGBA>> &
  Required<Record<TransitionFadeStyle, RGBA>> &
  Required<Record<ActiveTransitionFadeStyle, RGBA>>

interface TransitionFadeInfo {
  step: DiagramFadeStep
  active: boolean
}

const DEFAULT_THEME_RGB = {
  state: [228, 239, 232],
  activeState: [221, 255, 246],
  composite: [111, 138, 126],
  transition: [134, 225, 200],
  activeTransition: [221, 255, 246],
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
  "activeState",
  "composite",
  "start",
  "end",
  "choice",
] as const satisfies readonly FadeSourceStyle[]
const TRANSITION_FADE_STYLES = createTransitionFadeStyles()
const ACTIVE_TRANSITION_FADE_STYLES = createActiveTransitionFadeStyles()
const ACTIVE_TRANSITION_STYLES = new Set<StateCellStyle>([
  "activeTransition",
  ...Object.values(ACTIVE_TRANSITION_FADE_STYLES).flat(),
])
const TRANSITION_FADE_STYLES_SET = new Set<StateCellStyle>([
  ...Object.values(TRANSITION_FADE_STYLES).flat(),
  ...Object.values(ACTIVE_TRANSITION_FADE_STYLES).flat(),
])
const TRANSITION_FADE_INFOS: ReadonlyMap<StateCellStyle, TransitionFadeInfo> = new Map(
  FADE_SOURCE_STYLES.flatMap((source) =>
    FADE_STEPS.flatMap(
      (step): Array<[StateCellStyle, TransitionFadeInfo]> => [
        [`${source}TransitionFade${step}` as StateCellStyle, { step, active: false }],
        [`${source}ActiveTransitionFade${step}` as StateCellStyle, { step, active: true }],
      ],
    ),
  ),
)

let defaultAnsiTheme: Required<Record<StateCellStyle, string>> | undefined

function stateDefaultAnsiTheme(): Required<Record<StateCellStyle, string>> {
  defaultAnsiTheme ??= {
    state: ansiFg(DEFAULT_THEME_RGB.state),
    activeState: ansiFg(DEFAULT_THEME_RGB.activeState),
    composite: ansiFg(DEFAULT_THEME_RGB.composite),
    transition: ansiFg(DEFAULT_THEME_RGB.transition),
    activeTransition: ansiFg(DEFAULT_THEME_RGB.activeTransition),
    label: ansiFg(DEFAULT_THEME_RGB.label),
    noteBorder: ansiFg(DEFAULT_THEME_RGB.noteBorder),
    noteText: ansiFg(DEFAULT_THEME_RGB.noteText),
    noteConnector: ansiFg(DEFAULT_THEME_RGB.noteConnector),
    start: ansiFg(DEFAULT_THEME_RGB.start),
    end: ansiFg(DEFAULT_THEME_RGB.end),
    choice: ansiFg(DEFAULT_THEME_RGB.choice),
    ...createAnsiFadeTheme("state", DEFAULT_THEME_RGB.state, DEFAULT_THEME_RGB.transition),
    ...createAnsiFadeTheme("activeState", DEFAULT_THEME_RGB.activeState, DEFAULT_THEME_RGB.transition),
    ...createAnsiFadeTheme("composite", DEFAULT_THEME_RGB.composite, DEFAULT_THEME_RGB.transition),
    ...createAnsiFadeTheme("start", DEFAULT_THEME_RGB.start, DEFAULT_THEME_RGB.transition),
    ...createAnsiFadeTheme("end", DEFAULT_THEME_RGB.end, DEFAULT_THEME_RGB.transition),
    ...createAnsiFadeTheme("choice", DEFAULT_THEME_RGB.choice, DEFAULT_THEME_RGB.transition),
    ...createAnsiActiveTransitionFadeTheme("state", DEFAULT_THEME_RGB.state, DEFAULT_THEME_RGB.activeTransition),
    ...createAnsiActiveTransitionFadeTheme(
      "activeState",
      DEFAULT_THEME_RGB.activeState,
      DEFAULT_THEME_RGB.activeTransition,
    ),
    ...createAnsiActiveTransitionFadeTheme(
      "composite",
      DEFAULT_THEME_RGB.composite,
      DEFAULT_THEME_RGB.activeTransition,
    ),
    ...createAnsiActiveTransitionFadeTheme("start", DEFAULT_THEME_RGB.start, DEFAULT_THEME_RGB.activeTransition),
    ...createAnsiActiveTransitionFadeTheme("end", DEFAULT_THEME_RGB.end, DEFAULT_THEME_RGB.activeTransition),
    ...createAnsiActiveTransitionFadeTheme("choice", DEFAULT_THEME_RGB.choice, DEFAULT_THEME_RGB.activeTransition),
  }
  return defaultAnsiTheme
}

export function resolveStateAnsiTheme(
  theme: Partial<Record<StateCellStyle, string>> = {},
): Record<StateCellStyle, string> {
  return { ...stateDefaultAnsiTheme(), ...theme }
}

function createTransitionFadeStyles(): Record<FadeSourceStyle, readonly TransitionFadeStyle[]> {
  const styles = {} as Record<FadeSourceStyle, readonly TransitionFadeStyle[]>
  for (const source of FADE_SOURCE_STYLES) {
    styles[source] = numberedStyleKeys(`${source}TransitionFade`, FADE_STEPS)
  }
  return styles
}

function createActiveTransitionFadeStyles(): Record<FadeSourceStyle, readonly ActiveTransitionFadeStyle[]> {
  const styles = {} as Record<FadeSourceStyle, readonly ActiveTransitionFadeStyle[]>
  for (const source of FADE_SOURCE_STYLES) {
    styles[source] = numberedStyleKeys(`${source}ActiveTransitionFade`, FADE_STEPS)
  }
  return styles
}

function createAnsiFadeTheme(
  source: FadeSourceStyle,
  from: DiagramRgb,
  to: DiagramRgb,
): Record<TransitionFadeStyle, string> {
  return createAnsiRampTheme(TRANSITION_FADE_STYLES[source], from, to) as Record<TransitionFadeStyle, string>
}

function createAnsiActiveTransitionFadeTheme(
  source: FadeSourceStyle,
  from: DiagramRgb,
  to: DiagramRgb,
): Record<ActiveTransitionFadeStyle, string> {
  return createAnsiRampTheme(ACTIVE_TRANSITION_FADE_STYLES[source], from, to) as Record<
    ActiveTransitionFadeStyle,
    string
  >
}

export function stateDiagramStateColorKey(stateId: string, level: number): string {
  return diagramCellColorKey(stateId, level)
}

function stateMappedColor(
  colors: ReadonlyMap<string, RGBA> | undefined,
  stateId: string | undefined,
): RGBA | undefined {
  return mappedDiagramColor(colors, stateId)
}

function transitionFadeInfo(style: StateCellStyle | undefined): TransitionFadeInfo | undefined {
  return style ? TRANSITION_FADE_INFOS.get(style) : undefined
}

function assignStateFadeColors<Style extends StateCellStyle>(
  target: Partial<Record<Style, RGBA>>,
  styles: readonly Style[],
  from: RGBA,
  to: RGBA,
): void {
  for (const [index, style] of styles.entries()) {
    target[style] = blendColor(from, to, (index + 1) / (styles.length + 1))
  }
}

export function stateStyleColor(
  style: StateCellStyle | undefined,
  colors: StateStyleColors,
  stateColors?: ReadonlyMap<string, RGBA>,
  stateId?: string,
): RGBA | undefined {
  const stateColor = stateMappedColor(stateColors, stateId)
  if (!stateColor) return style ? colors[style] : undefined

  const fadeInfo = transitionFadeInfo(style)
  if (fadeInfo) {
    return blendColor(
      stateColor,
      fadeInfo.active ? colors.activeTransition : colors.transition,
      fadeInfo.step / (FADE_STEPS.length + 1),
    )
  }
  return stateColor
}

export function stateStyleBgColor(
  stateBgColors: ReadonlyMap<string, RGBA> | undefined,
  stateId: string | undefined,
): RGBA | undefined {
  return stateMappedColor(stateBgColors, stateId)
}

export function resolveStateStyleColors(
  colors: Partial<Record<StateCellStyle, RGBA | undefined>> = {},
): StateStyleColors {
  const state = colors.state ?? rgba(DEFAULT_THEME_RGB.state)
  const composite = colors.composite ?? rgba(DEFAULT_THEME_RGB.composite)
  const transition = colors.transition ?? rgba(DEFAULT_THEME_RGB.transition)
  const activeTransition = colors.activeTransition ?? rgba(DEFAULT_THEME_RGB.activeTransition)
  const activeState = colors.activeState ?? rgba(DEFAULT_THEME_RGB.activeState)
  const start = colors.start ?? rgba(DEFAULT_THEME_RGB.start)
  const end = colors.end ?? rgba(DEFAULT_THEME_RGB.end)
  const choice = colors.choice ?? transition
  const noteBorder = colors.noteBorder ?? rgba(DEFAULT_THEME_RGB.noteBorder)
  const noteText = colors.noteText ?? rgba(DEFAULT_THEME_RGB.noteText)
  const noteConnector = colors.noteConnector ?? noteBorder

  const sourceColors = {
    state,
    activeState,
    composite,
    start,
    end,
    choice,
  } satisfies Record<FadeSourceStyle, RGBA>
  const styleColors: Partial<Record<StateCellStyle, RGBA>> = {
    state,
    activeState,
    composite,
    transition,
    activeTransition,
    label: colors.label ?? transition,
    noteBorder,
    noteText,
    noteConnector,
    start,
    end,
    choice,
  }

  for (const source of FADE_SOURCE_STYLES) {
    assignStateFadeColors(styleColors, TRANSITION_FADE_STYLES[source], sourceColors[source], transition)
    assignStateFadeColors(styleColors, ACTIVE_TRANSITION_FADE_STYLES[source], sourceColors[source], activeTransition)
  }
  return styleColors as StateStyleColors
}

export function isStateActiveTransitionStyle(style: StateCellStyle | undefined): boolean {
  return style ? ACTIVE_TRANSITION_STYLES.has(style) : false
}

export function isStateTransitionFadeStyle(style: StateCellStyle | undefined): boolean {
  return style ? TRANSITION_FADE_STYLES_SET.has(style) : false
}

export function stateTransitionFadeStyle(
  source: FadeSourceStyle,
  active: boolean,
  distance: number,
  fadeFromSource: boolean,
): StateCellStyle {
  if (active) {
    if (!fadeFromSource) return "activeTransition"
    if (distance <= 0) return `${source}ActiveTransitionFade1` as ActiveTransitionFadeStyle
    if (distance >= FADE_STEPS.length) return "activeTransition"
    return `${source}ActiveTransitionFade${distance + 1}` as ActiveTransitionFadeStyle
  }
  if (distance <= 0) return `${source}TransitionFade1` as TransitionFadeStyle
  if (distance >= FADE_STEPS.length) return "transition"
  return `${source}TransitionFade${distance + 1}` as TransitionFadeStyle
}
