/**
 * A hovered generated avatar's animation. It runs once per frame, so it never allocates: every state and transition is
 * a frozen module singleton, events are reused by the driver, and the continuous time lives in an `AvatarClock` that
 * only `transitionAvatarAnimation` writes.
 */

// The animation starts once the pointer rests on the avatar's row, so passing over a list does no drawing.
export const AVATAR_REST_MS = 150

export const AVATAR_MAX_STEP_S = 0.1

export const AVATAR_DECAY_BASE = 0.002

export const AVATAR_SETTLE_EPSILON = 0.01

export type AvatarAnimationState =
  | { readonly status: "static" }
  /** Hovered, waiting out the rest delay before the first animated frame. */
  | { readonly status: "resting" }
  | { readonly status: "animating" }
  /** The pointer left; the animation slows back to the static frame. */
  | { readonly status: "easing" }
  | { readonly status: "disposed" }

export type AvatarClock = {
  entered: number
  last: number
  time: number
}

export type AvatarAnimationEvent =
  | { readonly type: "pointer.entered"; now: number; reduced: boolean }
  | { readonly type: "pointer.left" }
  | { readonly type: "frame"; now: number }
  | { readonly type: "motion.changed"; reduced: boolean }
  | { readonly type: "refresh" }
  | { readonly type: "disposed" }

export type AvatarAnimationEffect = "none" | "paint-static" | "paint-frame"

export type AvatarAnimationTransition = {
  readonly state: AvatarAnimationState
  readonly effect: AvatarAnimationEffect
}

const STATIC: AvatarAnimationState = Object.freeze({ status: "static" })

const RESTING: AvatarAnimationState = Object.freeze({ status: "resting" })

const ANIMATING: AvatarAnimationState = Object.freeze({ status: "animating" })

const EASING: AvatarAnimationState = Object.freeze({ status: "easing" })

const DISPOSED: AvatarAnimationState = Object.freeze({ status: "disposed" })

export const INITIAL_AVATAR_ANIMATION_STATE = STATIC

const EFFECTS: readonly AvatarAnimationEffect[] = ["none", "paint-static", "paint-frame"]

const TRANSITIONS = new Map(
  [STATIC, RESTING, ANIMATING, EASING, DISPOSED].map((state) => [
    state,
    new Map(EFFECTS.map((effect) => [effect, Object.freeze({ state, effect })])),
  ]),
)

const to = (state: AvatarAnimationState, effect: AvatarAnimationEffect): AvatarAnimationTransition =>
  TRANSITIONS.get(state)!.get(effect)!

export const AVATAR_POINTER_LEFT: AvatarAnimationEvent = Object.freeze({ type: "pointer.left" })

export const AVATAR_REFRESH: AvatarAnimationEvent = Object.freeze({ type: "refresh" })

export const AVATAR_DISPOSED: AvatarAnimationEvent = Object.freeze({ type: "disposed" })

export function createAvatarClock(): AvatarClock {
  return { entered: 0, last: 0, time: 0 }
}

export function transitionAvatarAnimation(
  state: AvatarAnimationState,
  clock: AvatarClock,
  event: AvatarAnimationEvent,
): AvatarAnimationTransition {
  if (state === DISPOSED) return to(state, "none")

  if (event.type === "disposed") {
    reset(clock)

    return to(DISPOSED, "none")
  }

  if (event.type === "motion.changed") {
    if (!event.reduced || state === STATIC) return to(state, "none")
    reset(clock)

    // A resting avatar still shows its static frame.
    return to(STATIC, state === RESTING ? "none" : "paint-static")
  }

  if (event.type === "refresh") return to(state, state === STATIC || state === RESTING ? "paint-static" : "none")

  if (state === STATIC) {
    if (event.type !== "pointer.entered" || event.reduced) return to(state, "none")
    clock.entered = clock.last = event.now
    clock.time = 0

    return to(RESTING, "none")
  }

  if (state === RESTING) {
    if (event.type === "pointer.left") {
      reset(clock)

      return to(STATIC, "none")
    }

    if (event.type !== "frame") return to(state, "none")

    if (event.now - clock.entered < AVATAR_REST_MS) {
      clock.last = event.now

      return to(state, "none")
    }
    clock.time += step(event.now - clock.last)
    clock.entered = 0
    clock.last = event.now

    return to(ANIMATING, "paint-frame")
  }

  if (state === ANIMATING) {
    if (event.type === "pointer.left") return to(EASING, "none")

    if (event.type !== "frame") return to(state, "none")
    clock.time += step(event.now - clock.last)
    clock.last = event.now

    return to(state, "paint-frame")
  }

  if (event.type === "pointer.entered") {
    if (event.reduced) return to(state, "none")
    clock.last = event.now

    return to(ANIMATING, "none")
  }

  if (event.type !== "frame") return to(state, "none")
  const time = clock.time * AVATAR_DECAY_BASE ** step(event.now - clock.last)

  if (time < AVATAR_SETTLE_EPSILON) {
    reset(clock)

    return to(STATIC, "paint-static")
  }
  clock.time = time
  clock.last = event.now

  return to(state, "paint-frame")
}

/** Hovered or easing: the driver runs the frame loop and follows the reduce motion setting. */
export function selectAvatarRunning(state: AvatarAnimationState) {
  return state === RESTING || state === ANIMATING || state === EASING
}

export function selectAvatarPaintTime(state: AvatarAnimationState, clock: Readonly<AvatarClock>) {
  return state === ANIMATING || state === EASING ? clock.time : 0
}

function step(ms: number) {
  return Math.max(0, Math.min(ms / 1000, AVATAR_MAX_STEP_S))
}

function reset(clock: AvatarClock) {
  clock.entered = 0
  clock.last = 0
  clock.time = 0
}
