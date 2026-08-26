import type { BorderStyle } from "@opentui/core"

export type StateDiagramDirection = "TB" | "TD" | "BT" | "LR" | "RL"
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
  /** Target rendered width. Oversized horizontal layouts fold vertically. */
  layoutMaxWidth?: number
}

export type NoteConnectorRampStyle = `noteConnectorRamp${1 | 2 | 3}`
export type StateDepartureRampStyle = `stateDepartureRamp${1 | 2 | 3}`
export type BaseStateCellStyle =
  | "state"
  | "stateBorder"
  | "composite"
  | "compositeLabel"
  | "transition"
  | "label"
  | "noteBorder"
  | "noteText"
  | "noteConnector"
  | "start"
  | "end"
  | "choice"
export type StateCellStyle = BaseStateCellStyle | NoteConnectorRampStyle | StateDepartureRampStyle
