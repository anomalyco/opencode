import { describe, expect, test } from "bun:test"
import { measureOffset, SEGMENTED_CONTROL_SPRING, type OffsetElement } from "./segmented-control"

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
