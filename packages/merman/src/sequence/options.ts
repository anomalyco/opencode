import type { BorderStyle } from "@opentui/core"

export const DEFAULT_MIN_PARTICIPANT_GAP = 18
export const DEFAULT_FRAGMENT_BORDER_STYLE = "rounded" satisfies BorderStyle
export const SEQUENCE_LIFELINE_FADE_STEPS = [1, 2, 3, 4, 5] as const

export function normalizeSequenceMinParticipantGap(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? DEFAULT_MIN_PARTICIPANT_GAP : Math.max(1, Math.floor(value))
}
