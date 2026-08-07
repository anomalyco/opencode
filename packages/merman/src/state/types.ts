import type { BorderStyle, ColorInput, TextBufferOptions } from "@opentui/core"
import type { DiagramColorMapInput } from "../core/color/map.js"
import type { DiagramFadeStep } from "../core/color/style.js"

export type StateDiagramDirection = "TB" | "TD" | "LR" | "RL"
export type StateDiagramArrowHeadStyle = "filled" | "line"

export interface StateDiagramState {
  id: string
  label: string
  kind: "state" | "start" | "end" | "choice"
  parentId?: string
}

export interface StateDiagramTransition {
  from: string
  to: string
  label: string
}

export interface StateDiagramActiveTransition {
  from: string
  to: string
  label?: string
}

export interface StateDiagramCompositeState {
  id: string
  label: string
  parentId?: string
}

export interface StateDiagramNote {
  target: string
  position: "left" | "right"
  lines: string[]
}

export type StateDiagramActiveTransitionSelection =
  | StateDiagramActiveTransition
  | readonly StateDiagramActiveTransition[]
export type StateDiagramStateColors = DiagramColorMapInput

export interface StateDiagram {
  direction: StateDiagramDirection
  states: StateDiagramState[]
  transitions: StateDiagramTransition[]
  composites: StateDiagramCompositeState[]
  notes: StateDiagramNote[]
}

export interface StateDiagramRenderOptions {
  direction?: StateDiagramDirection
  borderStyle?: BorderStyle
  arrowHeadStyle?: StateDiagramArrowHeadStyle
  minStateGap?: number
  activeState?: string
  activeTransition?: StateDiagramActiveTransitionSelection
}

export interface StateDiagramAnsiOptions extends StateDiagramRenderOptions {
  theme?: StateDiagramAnsiTheme
}

export interface StateDiagramOptions extends TextBufferOptions, StateDiagramRenderOptions {
  content?: string
  stateColor?: ColorInput
  activeStateColor?: ColorInput
  compositeColor?: ColorInput
  transitionColor?: ColorInput
  labelColor?: ColorInput
  noteBorderColor?: ColorInput
  noteTextColor?: ColorInput
  noteConnectorColor?: ColorInput
  startColor?: ColorInput
  endColor?: ColorInput
  choiceColor?: ColorInput
  activeTransitionColor?: ColorInput
  stateColors?: StateDiagramStateColors
  stateBgColors?: StateDiagramStateColors
}

export type StateDiagramAnsiTheme = Partial<Record<StateCellStyle, string>>

export type FadeSourceStyle = "state" | "activeState" | "composite" | "start" | "end" | "choice"
export type TransitionFadeStyle = `${FadeSourceStyle}TransitionFade${DiagramFadeStep}`
export type ActiveTransitionFadeStyle = `${FadeSourceStyle}ActiveTransitionFade${DiagramFadeStep}`
export type BaseStateCellStyle =
  | "state"
  | "activeState"
  | "composite"
  | "transition"
  | "activeTransition"
  | "label"
  | "noteBorder"
  | "noteText"
  | "noteConnector"
  | "start"
  | "end"
  | "choice"
export type StateCellStyle = BaseStateCellStyle | TransitionFadeStyle | ActiveTransitionFadeStyle
