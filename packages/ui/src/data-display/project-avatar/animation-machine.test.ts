import { describe, expect, test } from "bun:test"
import {
  AVATAR_DISPOSED,
  AVATAR_POINTER_LEFT,
  AVATAR_REFRESH,
  AVATAR_REST_MS,
  createAvatarClock,
  INITIAL_AVATAR_ANIMATION_STATE,
  selectAvatarPaintTime,
  selectAvatarRunning,
  transitionAvatarAnimation,
  type AvatarAnimationEvent,
  type AvatarAnimationState,
  type AvatarAnimationTransition,
  type AvatarClock,
} from "./animation-machine"

const enter = (now: number, reduced = false): AvatarAnimationEvent => ({ type: "pointer.entered", now, reduced })

const frame = (now: number): AvatarAnimationEvent => ({ type: "frame", now })

const motion = (reduced: boolean): AvatarAnimationEvent => ({ type: "motion.changed", reduced })

function run(clock: AvatarClock, state: AvatarAnimationState, ...events: AvatarAnimationEvent[]) {
  return events.reduce<AvatarAnimationTransition>(
    (result, event) => transitionAvatarAnimation(result.state, clock, event),
    { state, effect: "none" },
  )
}

const animating = (clock: AvatarClock) =>
  run(clock, INITIAL_AVATAR_ANIMATION_STATE, enter(0), frame(AVATAR_REST_MS + 10)).state

describe("transitionAvatarAnimation", () => {
  test("waits out the rest delay, then animates", () => {
    const clock = createAvatarClock()
    const resting = run(clock, INITIAL_AVATAR_ANIMATION_STATE, enter(0), frame(80))

    expect(resting.state.status).toBe("resting")
    expect(resting.effect).toBe("none")
    expect(selectAvatarRunning(resting.state)).toBe(true)

    const first = run(clock, resting.state, frame(AVATAR_REST_MS + 10))

    expect(first).toMatchObject({ state: { status: "animating" }, effect: "paint-frame" })
    expect(selectAvatarPaintTime(first.state, clock)).toBeCloseTo(0.08)
  })

  test("passing over a row stops at once without painting", () => {
    const clock = createAvatarClock()
    const result = run(clock, INITIAL_AVATAR_ANIMATION_STATE, enter(0), frame(30), AVATAR_POINTER_LEFT)

    expect(result).toMatchObject({ state: INITIAL_AVATAR_ANIMATION_STATE, effect: "none" })
    expect(selectAvatarRunning(result.state)).toBe(false)
    expect(clock).toEqual(createAvatarClock())
  })

  test("a refresh repaints the static frame while resting, not while animating", () => {
    const clock = createAvatarClock()
    const resting = run(clock, INITIAL_AVATAR_ANIMATION_STATE, enter(0)).state

    expect(run(clock, INITIAL_AVATAR_ANIMATION_STATE, AVATAR_REFRESH).effect).toBe("paint-static")
    expect(run(clock, resting, AVATAR_REFRESH)).toMatchObject({ state: resting, effect: "paint-static" })
    expect(run(clock, animating(clock), AVATAR_REFRESH).effect).toBe("none")
  })

  test("reduced motion blocks the hover and stops a running animation", () => {
    const clock = createAvatarClock()

    expect(run(clock, INITIAL_AVATAR_ANIMATION_STATE, enter(0, true)).state).toBe(INITIAL_AVATAR_ANIMATION_STATE)

    const resting = run(clock, INITIAL_AVATAR_ANIMATION_STATE, enter(0)).state

    expect(run(clock, resting, motion(true))).toMatchObject({ state: INITIAL_AVATAR_ANIMATION_STATE, effect: "none" })

    const stopped = run(clock, animating(clock), motion(true))

    expect(stopped).toMatchObject({ state: INITIAL_AVATAR_ANIMATION_STATE, effect: "paint-static" })
    expect(clock).toEqual(createAvatarClock())
    expect(run(clock, animating(clock), motion(false)).state.status).toBe("animating")
  })

  test("eases back after the pointer leaves, resumes without a rest delay, and settles", () => {
    const clock = createAvatarClock()
    const easing = run(clock, animating(clock), AVATAR_POINTER_LEFT)

    expect(easing).toMatchObject({ state: { status: "easing" }, effect: "none" })
    expect(run(clock, easing.state, enter(170, true)).state).toBe(easing.state)

    const resumed = run(clock, easing.state, enter(170), frame(186))

    expect(resumed).toMatchObject({ state: { status: "animating" }, effect: "paint-frame" })

    const eased = run(clock, resumed.state, AVATAR_POINTER_LEFT, frame(286))

    expect(eased).toMatchObject({ state: { status: "easing" }, effect: "paint-frame" })
    expect(clock.time).toBeLessThan(0.116)

    const settled = run(clock, eased.state, frame(386), frame(486), frame(586))

    expect(settled).toMatchObject({ state: INITIAL_AVATAR_ANIMATION_STATE, effect: "paint-static" })
  })

  test("a frame step never runs backwards or past the cap", () => {
    const clock = createAvatarClock()
    const state = animating(clock)
    const time = clock.time

    run(clock, state, frame(0))
    expect(clock.time).toBe(time)
    run(clock, state, frame(10_000))
    expect(clock.time).toBeCloseTo(time + 0.1)
  })

  test("frames reuse the same frozen transition", () => {
    const clock = createAvatarClock()
    const state = animating(clock)
    const first = transitionAvatarAnimation(state, clock, frame(200))

    expect(transitionAvatarAnimation(state, clock, frame(216))).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
  })

  test("disposing ignores later events", () => {
    const clock = createAvatarClock()
    const disposed = run(clock, animating(clock), AVATAR_DISPOSED).state

    expect(selectAvatarRunning(disposed)).toBe(false)
    expect(run(clock, disposed, enter(0), frame(500), AVATAR_REFRESH)).toMatchObject({
      state: disposed,
      effect: "none",
    })
  })
})
