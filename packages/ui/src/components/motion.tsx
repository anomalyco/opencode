export { animate, springValue } from "motion"
export type { AnimationPlaybackControls } from "motion"

export const HEIGHT_DURATION = 0.5
export const FADE_DURATION = 0.5

export const HEIGHT_SPRING = {
  type: "spring" as const,
  visualDuration: HEIGHT_DURATION,
  bounce: 0,
}

export const TOOL_HEIGHT_DURATION = HEIGHT_DURATION

export const TOOL_HEIGHT_SPRING = {
  type: "spring" as const,
  visualDuration: TOOL_HEIGHT_DURATION,
  bounce: 0,
}

export const FADE_SPRING = {
  type: "spring" as const,
  visualDuration: FADE_DURATION,
  bounce: 0,
}

export const GLOW_SPRING = {
  type: "spring" as const,
  visualDuration: 0.4,
  bounce: 0.15,
}
