import { describe, expect, test } from "bun:test"
import {
  HIDDEN_INDICATOR,
  selectIndicatorReady,
  transitionSegmentedIndicator,
  type IndicatorBox,
  type SegmentedIndicatorState,
} from "./machine"
import { measureOffset, SEGMENTED_CONTROL_SPRING, type OffsetElement } from "./segmented-control"

const measured = (value: string | null, box: IndicatorBox | null, reducedMotion = false) =>
  ({ type: "measured", value, box, reducedMotion }) as const

const placed = (value: string, box: IndicatorBox): SegmentedIndicatorState => ({ status: "placed", value, box })

describe("segmented indicator machine", () => {
  test("a selection made while hidden jumps once shown instead of springing from the old segment", () => {
    const hidden = transitionSegmentedIndicator(placed("a", { x: 0, width: 100 }), measured("b", { x: 0, width: 0 }))

    expect(hidden.state).toBe(HIDDEN_INDICATOR)
    expect(hidden.effect).toEqual({ type: "stop" })
    expect(selectIndicatorReady(hidden.state)).toBe(false)

    const shown = transitionSegmentedIndicator(hidden.state, measured("c", { x: 200, width: 100 }))

    expect(shown.state).toEqual(placed("c", { x: 200, width: 100 }))
    expect(shown.effect).toEqual({ type: "jump", box: { x: 200, width: 100 } })
  })

  test("the first measurement jumps and later selections animate unless motion is reduced", () => {
    const first = transitionSegmentedIndicator(HIDDEN_INDICATOR, measured("a", { x: 0, width: 100 }))

    expect(first.effect).toEqual({ type: "jump", box: { x: 0, width: 100 } })
    expect(transitionSegmentedIndicator(first.state, measured("b", { x: 100, width: 80 })).effect).toEqual({
      type: "animate",
      box: { x: 100, width: 80 },
    })
    expect(transitionSegmentedIndicator(first.state, measured("b", { x: 100, width: 80 }, true)).effect).toEqual({
      type: "jump",
      box: { x: 100, width: 80 },
    })
  })

  test("a resize of the selected segment jumps, and an unchanged box keeps the state", () => {
    const state = placed("a", { x: 0, width: 100 })

    expect(transitionSegmentedIndicator(state, measured("a", { x: 0, width: 100 }))).toEqual({ state, effect: null })
    expect(transitionSegmentedIndicator(state, measured("a", { x: 0, width: 100 })).state).toBe(state)
    expect(transitionSegmentedIndicator(state, measured("a", { x: 4, width: 120 })).effect).toEqual({
      type: "jump",
      box: { x: 4, width: 120 },
    })
  })

  test("deselecting or unmounting during a spring stops it", () => {
    const state = placed("b", { x: 100, width: 80 })
    const cleared = transitionSegmentedIndicator(state, measured(null, null))

    expect(cleared).toEqual({ state: HIDDEN_INDICATOR, effect: { type: "stop" } })

    const disposed = transitionSegmentedIndicator(state, { type: "disposed" })

    expect(disposed.effect).toEqual({ type: "stop" })
    expect(transitionSegmentedIndicator(disposed.state, measured("a", { x: 0, width: 100 }))).toEqual({
      state: disposed.state,
      effect: null,
    })
    expect(transitionSegmentedIndicator(HIDDEN_INDICATOR, { type: "disposed" }).effect).toBeNull()
  })
})

describe("SegmentedControl", () => {
  test("uses snappier non-bouncy spring default", () => {
    expect(SEGMENTED_CONTROL_SPRING).toEqual({
      type: "spring",
      visualDuration: 0.15,
      bounce: 0,
    })
  })

  test("measures button offset along offsetParent chain to root", () => {
    const root: OffsetElement = {
      offsetLeft: 0,
      offsetWidth: 232,
      offsetParent: null,
      getBoundingClientRect: () => ({ left: 0 }),
    }

    const wrapper: OffsetElement = {
      offsetLeft: 8,
      offsetWidth: 216,
      offsetParent: root,
      getBoundingClientRect: () => ({ left: 8 }),
    }

    const button: OffsetElement = {
      offsetLeft: 44,
      offsetWidth: 76,
      offsetParent: wrapper,
      getBoundingClientRect: () => ({ left: 52 }),
    }

    expect(measureOffset(root, button)).toEqual({ x: 52, width: 76 })
  })

  test("falls back to bounding client rect difference when offsetParent does not reach root", () => {
    const root: OffsetElement = {
      offsetLeft: 0,
      offsetWidth: 232,
      offsetParent: null,
      getBoundingClientRect: () => ({ left: 100 }),
    }

    const button: OffsetElement = {
      offsetLeft: 0,
      offsetWidth: 64,
      offsetParent: null,
      getBoundingClientRect: () => ({ left: 164 }),
    }

    expect(measureOffset(root, button)).toEqual({ x: 64, width: 64 })
  })
})
