import { followValue } from "motion"
import type { MotionValue } from "motion"

export { animate, springValue } from "motion"
export type { AnimationPlaybackControls } from "motion"

/**
 * Like `springValue` but preserves getters on the config object.
 * `springValue` spreads config at creation, snapshotting getter values.
 * This passes the config through to `followValue` intact, so getters
 * on `visualDuration` etc. fire on every `.set()` call.
 */
export function tunableSpringValue<T extends string | number>(initial: T, config: SpringConfig): MotionValue<T> {
  return followValue(initial, config as any)
}

let _growDuration = 0.5
let _collapsibleDuration = 0.3

export const GROW_SPRING = {
  type: "spring" as const,
  get visualDuration() {
    return _growDuration
  },
  bounce: 0,
}

export const COLLAPSIBLE_SPRING = {
  type: "spring" as const,
  get visualDuration() {
    return _collapsibleDuration
  },
  bounce: 0,
}

export const setGrowDuration = (v: number) => {
  _growDuration = v
}
export const setCollapsibleDuration = (v: number) => {
  _collapsibleDuration = v
}
export const getGrowDuration = () => _growDuration
export const getCollapsibleDuration = () => _collapsibleDuration

export type SpringConfig = { type: "spring"; visualDuration: number; bounce: number }

export const FAST_SPRING = {
  type: "spring" as const,
  visualDuration: 0.35,
  bounce: 0,
}

export const GLOW_SPRING = {
  type: "spring" as const,
  visualDuration: 0.4,
  bounce: 0.15,
}

export const WIPE_MASK =
  "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 60%, rgba(0,0,0,0) 100%)"

export const clearMaskStyles = (el: HTMLElement) => {
  el.style.maskImage = ""
  el.style.webkitMaskImage = ""
  el.style.maskSize = ""
  el.style.webkitMaskSize = ""
  el.style.maskRepeat = ""
  el.style.webkitMaskRepeat = ""
  el.style.maskPosition = ""
  el.style.webkitMaskPosition = ""
}

export const clearFadeStyles = (el: HTMLElement) => {
  el.style.opacity = ""
  el.style.filter = ""
  el.style.transform = ""
}
