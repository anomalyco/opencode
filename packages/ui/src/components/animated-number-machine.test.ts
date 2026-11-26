import { describe, expect, test } from "bun:test"
import {
  createAnimatedDigitState,
  createAnimatedNumberState,
  selectAnimatedDigitRolling,
  selectAnimatedDigitStep,
  selectAnimatedNumberPlaces,
  selectAnimatedNumberResizing,
  transitionAnimatedDigit,
  transitionAnimatedNumber,
  type AnimatedDigitEvent,
  type AnimatedDigitState,
  type AnimatedNumberEvent,
  type AnimatedNumberState,
  type AnimatedNumberTransition,
} from "./animated-number-machine"

function number(state: AnimatedNumberState, ...events: AnimatedNumberEvent[]) {
  return events.reduce<AnimatedNumberTransition<AnimatedNumberState>>(
    (result, event) => transitionAnimatedNumber(result.state, event),
    { state, effects: [] },
  )
}

function digit(state: AnimatedDigitState, ...events: AnimatedDigitEvent[]) {
  return events.reduce<AnimatedNumberTransition<AnimatedDigitState>>(
    (result, event) => transitionAnimatedDigit(result.state, event),
    { state, effects: [] },
  )
}

const value = (next: number, canAnimate = true): AnimatedNumberEvent => ({
  type: "value.changed",
  value: next,
  canAnimate,
})

const roll = (next: number, canAnimate = true, direction: 1 | -1 = 1): AnimatedDigitEvent => ({
  type: "digit.changed",
  digit: next,
  direction,
  canAnimate,
})

describe("animated number machine", () => {
  test("under reduced motion a digit-count change settles at once instead of waiting for a transition end", () => {
    // Reduced motion runs transitions in 0 ms, which dispatch no `transitionend`.
    const grown = number(createAnimatedNumberState(9), value(10, false), value(9, false))

    expect(selectAnimatedNumberResizing(grown.state)).toBe(false)
    expect(selectAnimatedNumberPlaces(grown.state)).toBe(2)
    expect(grown.effects).toEqual([])
  })

  test("a cancelled width transition settles and drops the extra leading place", () => {
    const resizing = number(createAnimatedNumberState(9), value(10))

    expect(resizing.effects).toEqual([{ type: "watch", attempt: 1 }])
    expect(selectAnimatedNumberPlaces(resizing.state)).toBe(3)

    const shrunk = number(resizing.state, value(9), { type: "resize.ended" })

    expect(shrunk.state).toMatchObject({ status: "static", value: 9, places: 2 })
    expect(shrunk.effects).toEqual([{ type: "clear" }])
  })

  test("the fallback settles only the eased change it was armed for", () => {
    const first = number(createAnimatedNumberState(9), value(10)).state
    const second = number(first, value(9)).state

    expect(number(second, { type: "resize.timed-out", attempt: 1 }).state).toBe(second)
    expect(number(second, { type: "resize.timed-out", attempt: 2 }).state).toMatchObject({
      status: "static",
      places: 2,
    })
  })

  test("a change that keeps the target digit count keeps the running width transition", () => {
    const resizing = number(createAnimatedNumberState(9), value(10)).state
    const next = number(resizing, value(11))

    expect(next.state).toMatchObject({ status: "resizing", attempt: 1, value: 11 })
    expect(next.effects).toEqual([])
  })

  test("a change while detached settles a running resize and its fallback", () => {
    const resizing = number(createAnimatedNumberState(9), value(10)).state

    expect(number(resizing, value(21, false))).toEqual({
      state: { status: "static", attempt: 1, value: 21, direction: 1, places: 3 },
      effects: [{ type: "clear" }],
    })
  })

  test("a digit under reduced motion lands on its value without rolling", () => {
    const settled = digit(createAnimatedDigitState(9), roll(0, false))

    expect(selectAnimatedDigitRolling(settled.state)).toBe(false)
    expect(selectAnimatedDigitStep(settled.state)).toBe(10)
  })

  test("a cancelled or timed-out roll settles back to the middle of the track", () => {
    const rolling = digit(createAnimatedDigitState(9), roll(0))

    expect(selectAnimatedDigitStep(rolling.state)).toBe(20)
    expect(selectAnimatedDigitStep(digit(rolling.state, { type: "roll.ended" }).state)).toBe(10)
    expect(digit(rolling.state, { type: "roll.timed-out", attempt: 1 }).state).toEqual({
      status: "static",
      attempt: 1,
      digit: 0,
      step: 10,
    })
  })

  test("an unchanged digit keeps its roll, and a retargeted roll gets a new attempt", () => {
    const rolling = digit(createAnimatedDigitState(0), roll(1)).state

    expect(digit(rolling, roll(1))).toEqual({ state: rolling, effects: [] })

    const retargeted = digit(createAnimatedDigitState(9), roll(0), roll(1))

    expect(retargeted.state).toEqual({ status: "rolling", attempt: 2, digit: 1, step: 21 })
    expect(retargeted.effects).toEqual([{ type: "watch", attempt: 2 }])
    expect(digit(retargeted.state, { type: "roll.timed-out", attempt: 1 }).state).toBe(retargeted.state)
  })

  test("a roll that would run off the track settles at once", () => {
    const far = digit(createAnimatedDigitState(0), roll(9), roll(8), roll(7))

    expect(far.state).toEqual({ status: "static", attempt: 2, digit: 7, step: 17 })
    expect(far.effects).toEqual([{ type: "clear" }])
  })

  test("disposing drops a pending fallback and ignores later events", () => {
    const disposed = digit(createAnimatedDigitState(0), roll(1), { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "clear" }])
    expect(digit(disposed.state, roll(5)).state).toBe(disposed.state)
  })
})
