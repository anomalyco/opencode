import { describe, expect, test } from "bun:test"
import {
  HOVER_ENTERED,
  HOVER_LEFT,
  INITIAL_SCROLL_THUMB_STATE,
  overflowChanged,
  SCROLL_IDLE_ELAPSED,
  SCROLL_THUMB_DISPOSED,
  SCROLLED,
  selectDraggingAxis,
  selectShowVerticalThumb,
  selectThumbScrolling,
  selectThumbVisible,
  transitionScrollThumb,
  type ScrollThumbEvent,
  type ScrollThumbState,
  type ScrollThumbTransition,
} from "./scroll-view-machine"

function run(state: ScrollThumbState, ...events: ScrollThumbEvent[]) {
  return events.reduce<ScrollThumbTransition>((result, event) => transitionScrollThumb(result.state, event), {
    state,
    effects: [],
  })
}

const drag = (pointerId = 1): ScrollThumbEvent => ({
  type: "drag.started",
  axis: "vertical",
  pointerId,
  grabOffset: 4,
  rtl: false,
})

const overflowing = run(INITIAL_SCROLL_THUMB_STATE, overflowChanged(true, false)).state

describe("scroll view thumb machine", () => {
  test("content that stops overflowing mid-drag ends the drag, so the thumb is not stuck when it overflows again", () => {
    // The thumb unmounts with its overflow, and a removed element drops capture without a `pointerup`.
    const shrunk = run(overflowing, drag(), overflowChanged(false, false))

    expect(shrunk.state.status).toBe("idle")
    expect(shrunk.effects).toEqual(["release-capture"])

    const grown = run(shrunk.state, overflowChanged(true, false)).state

    expect(selectDraggingAxis(grown)).toBeUndefined()
    expect(selectThumbVisible(grown, true)).toBe(false)
  })

  test("a drag ends only for the pointer that started it", () => {
    const dragging = run(overflowing, drag(1)).state

    expect(run(dragging, { type: "drag.ended", pointerId: 2 }).state).toBe(dragging)
    expect(run(dragging, { type: "drag.ended", pointerId: 1 })).toEqual({
      state: overflowing,
      effects: ["release-capture"],
    })
  })

  test("a drag cannot start on an axis without overflow", () => {
    expect(run(INITIAL_SCROLL_THUMB_STATE, drag()).state).toBe(INITIAL_SCROLL_THUMB_STATE)
  })

  test("a drag that scrolled keeps the thumb up for the idle delay after release", () => {
    const released = run(overflowing, drag(), SCROLLED, { type: "drag.ended", pointerId: 1 })

    expect(released.state.status).toBe("scrolling")
    expect(released.effects).toEqual(["release-capture", "reset-idle-timer"])
    expect(selectThumbVisible(run(released.state, SCROLL_IDLE_ELAPSED).state, false)).toBe(false)
  })

  test("hover shows the thumb only in hover mode; scrolling and dragging show it in both", () => {
    const hovered = run(overflowing, HOVER_ENTERED).state

    expect(selectThumbVisible(hovered, true)).toBe(true)
    expect(selectThumbVisible(hovered, false)).toBe(false)
    expect(selectThumbVisible(run(overflowing, SCROLLED).state, false)).toBe(true)
    expect(selectThumbVisible(run(overflowing, drag()).state, false)).toBe(true)
    expect(selectThumbVisible(run(hovered, HOVER_LEFT).state, true)).toBe(false)
  })

  test("scrolling without overflow does not arm the idle timer", () => {
    expect(run(INITIAL_SCROLL_THUMB_STATE, SCROLLED).effects).toEqual([])
  })

  test("losing all overflow while scrolling settles and drops the idle timer", () => {
    const settled = run(overflowing, SCROLLED, overflowChanged(false, false))

    expect(settled.state.status).toBe("idle")
    expect(settled.effects).toEqual(["clear-idle-timer"])
  })

  test("disposing mid-drag releases capture and the idle timer, then ignores every event", () => {
    const disposed = run(overflowing, SCROLLED, drag(), SCROLL_THUMB_DISPOSED)

    expect(disposed.effects).toEqual(["release-capture", "clear-idle-timer"])
    expect(selectShowVerticalThumb(disposed.state)).toBe(false)
    expect(run(disposed.state, SCROLLED, overflowChanged(true, true)).state).toBe(disposed.state)
  })

  test("a held drag keeps the scroll reveal off its idle timer until release", () => {
    // MenuScroll re-armed its 800 ms timer on every drag scroll, so holding the thumb still cleared `data-scrolling`
    // mid-drag and the release started no idle window.
    const scrolling = run(overflowing, SCROLLED).state
    expect(selectThumbScrolling(scrolling)).toBe(true)

    const dragging = run(scrolling, drag())
    expect(dragging.effects).toEqual(["clear-idle-timer"])
    expect(selectThumbScrolling(dragging.state)).toBe(false)
    expect(selectDraggingAxis(dragging.state)).toBe("vertical")

    const held = run(dragging.state, SCROLLED, SCROLL_IDLE_ELAPSED, SCROLLED)
    expect(held.effects).toEqual([])
    expect(selectDraggingAxis(held.state)).toBe("vertical")

    const released = run(held.state, { type: "drag.ended", pointerId: 1 })
    expect(released.effects).toEqual(["release-capture", "reset-idle-timer"])
    expect(selectThumbScrolling(released.state)).toBe(true)
    expect(selectThumbScrolling(run(released.state, SCROLL_IDLE_ELAPSED).state)).toBe(false)
  })

  test("a drag frame allocates no transition once the drag has scrolled", () => {
    const dragging = run(overflowing, drag(), SCROLLED).state

    expect(transitionScrollThumb(dragging, SCROLLED)).toBe(transitionScrollThumb(dragging, SCROLLED))
    expect(transitionScrollThumb(dragging, overflowChanged(true, false))).toBe(
      transitionScrollThumb(dragging, overflowChanged(true, false)),
    )
  })

  test("repeated scroll, wheel and resize events reuse one transition", () => {
    const scrolling = run(overflowing, SCROLLED).state
    const dragging = run(overflowing, drag(), SCROLLED).state

    expect(transitionScrollThumb(scrolling, SCROLLED)).toBe(transitionScrollThumb(scrolling, SCROLLED))
    expect(transitionScrollThumb(scrolling, overflowChanged(true, false)).state).toBe(scrolling)
    expect(transitionScrollThumb(dragging, SCROLLED).state).toBe(dragging)
    expect(transitionScrollThumb(dragging, overflowChanged(true, false)).state).toBe(dragging)
  })
})
