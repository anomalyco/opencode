import type { BorderStyle, ColorInput, TextBufferOptions } from "@opentui/core"

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

export type SequenceDiagramAnsiTheme = Partial<Record<AnsiSequenceCellStyle, string>>

export interface SequenceDiagramAnsiOptions extends SequenceDiagramRenderOptions {
  theme?: SequenceDiagramAnsiTheme
}

export interface SequenceDiagramOptions extends TextBufferOptions, SequenceDiagramRenderOptions {
  content?: string
  participantColor?: ColorInput
  lifelineColor?: ColorInput
  groupColor?: ColorInput
  requestColor?: ColorInput
  responseColor?: ColorInput
  noteColor?: ColorInput
  noteBackgroundColor?: ColorInput
}

export type MessageStyle = "request" | "response"
export type FadeStyle = `${MessageStyle}Fade${1 | 2 | 3 | 4 | 5}`
export type AnsiSequenceCellStyle =
  | "participant"
  | "lifeline"
  | "group"
  | MessageStyle
  | FadeStyle
  | "fragment"
  | "fragmentLabel"
  | "note"
export type SequenceCellStyle = AnsiSequenceCellStyle | "noteBadge"
