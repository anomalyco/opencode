export { animate, springValue } from "motion"
export type { AnimationPlaybackControls } from "motion"

export const HEIGHT_DURATION = 0.3
export const FADE_DURATION = 0.5
export const TOGGLE_DURATION = 0.3

export const HEIGHT_SPRING = {
  type: "spring" as const,
  visualDuration: HEIGHT_DURATION,
  bounce: 0,
}

export const TOGGLE_SPRING = {
  type: "spring" as const,
  visualDuration: TOGGLE_DURATION,
  bounce: 0,
}

export const FADE_SPRING = {
  type: "spring" as const,
  visualDuration: FADE_DURATION,
  bounce: 0,
}
