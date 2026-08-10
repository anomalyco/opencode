import type { BorderStyle } from "@opentui/core"

export interface SequenceParticipant {
  id: string
  label: string
}

export interface SequenceParticipantGroup {
  label: string
  participantIds: string[]
}

export interface SequenceMessage {
  from: string
  to: string
  label: string
  style: "solid" | "dashed"
  head?: SequenceArrowHead
  number?: number
  activate?: string
  deactivate?: string
}

export type SequenceArrowHead = "open" | "cross" | "async"

export interface SequenceNote {
  over: string[]
  label: string
  position?: "over" | "left" | "right"
}

export interface SequenceActivation {
  participant: string
  active: boolean
}

export interface SequenceFragment {
  kind: "alt" | "else" | "loop" | "end"
  label: string
}

export type SequenceStep =
  | { type: "message"; message: SequenceMessage }
  | { type: "note"; note: SequenceNote }
  | { type: "activation"; activation: SequenceActivation }
  | { type: "fragment"; fragment: SequenceFragment }

export interface SequenceDiagram {
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
  steps: SequenceStep[]
  groups: SequenceParticipantGroup[]
}

export interface SequenceDiagramRenderOptions {
  compact?: boolean
  minParticipantGap?: number
  fragmentBorderStyle?: BorderStyle
}

export type MessageStyle = "request" | "response"
export type FadeStyle = `${MessageStyle}Fade${1 | 2 | 3 | 4 | 5}`
export type LifelineRampStyle = `lifelineRamp${1 | 2 | 3}`
export type LifelineFadeStyle = `lifelineFade${1 | 2 | 3 | 4 | 5}`
export type SequenceCellStyle =
  | "participant"
  | "lifeline"
  | "group"
  | MessageStyle
  | FadeStyle
  | LifelineRampStyle
  | LifelineFadeStyle
  | "fragment"
  | "fragmentLabel"
  | "note"
  | "noteBadge"
