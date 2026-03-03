export { animate, springValue } from "motion"
export type { AnimationPlaybackControls } from "motion"

export const HEIGHT_DURATION = 0.5
export const FADE_DURATION = 0.5
export const COLLAPSIBLE_CONTENT_HEIGHT_DURATION = 0.3
export const COLLAPSIBLE_CONTENT_FADE_DURATION = COLLAPSIBLE_CONTENT_HEIGHT_DURATION

export const HEIGHT_SPRING = {
  type: "spring" as const,
  visualDuration: HEIGHT_DURATION,
  bounce: 0,
}

export const COLLAPSIBLE_CONTENT_HEIGHT_SPRING = {
  type: "spring" as const,
  visualDuration: COLLAPSIBLE_CONTENT_HEIGHT_DURATION,
  bounce: 0,
}

export const FADE_SPRING = {
  type: "spring" as const,
  visualDuration: FADE_DURATION,
  bounce: 0,
}

export const COLLAPSIBLE_CONTENT_FADE_SPRING = {
  type: "spring" as const,
  visualDuration: COLLAPSIBLE_CONTENT_FADE_DURATION,
  bounce: 0,
}

export const GLOW_SPRING = {
  type: "spring" as const,
  visualDuration: 0.4,
  bounce: 0.15,
}
