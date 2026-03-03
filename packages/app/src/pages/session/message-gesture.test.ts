import { describe, expect, test } from "bun:test"
import { normalizeWheelDelta, shouldMarkBoundaryGesture } from "./message-gesture"

describe("normalizeWheelDelta", () => {
  test("converts line mode to px", () => {
    expect(normalizeWheelDelta({ deltaY: 3, deltaMode: 1, rootHeight: 500 })).toBe(120)
  })

  test("converts page mode to container height", () => {
    expect(normalizeWheelDelta({ deltaY: -1, deltaMode: 2, rootHeight: 600 })).toBe(-600)
  })

  test("keeps pixel mode unchanged", () => {
    expect(normalizeWheelDelta({ deltaY: 16, deltaMode: 0, rootHeight: 600 })).toBe(16)
  })
})

describe("shouldMarkBoundaryGesture", () => {
  test("marks when nested scroller cannot scroll", () => {
    expect(
      shouldMarkBoundaryGesture({
        delta: 20,
        scrollTop: 0,
        scrollHeight: 300,
        clientHeight: 300,
      }),
    ).toBe(true)
  })

  test("marks when scrolling beyond top boundary", () => {
    // column-reverse: scrollTop=-590 means 590px from bottom (10px from top, max=600)
    expect(
      shouldMarkBoundaryGesture({
        delta: -40,
        scrollTop: -590,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true)
  })

  test("marks when scrolling beyond bottom boundary", () => {
    // column-reverse: scrollTop=-20 means 20px from bottom
    expect(
      shouldMarkBoundaryGesture({
        delta: 50,
        scrollTop: -20,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true)
  })

  test("does not mark when nested scroller can consume movement", () => {
    // column-reverse: scrollTop=-400 means 400px from bottom (middle of scroll)
    expect(
      shouldMarkBoundaryGesture({
        delta: 20,
        scrollTop: -400,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(false)
  })
})
