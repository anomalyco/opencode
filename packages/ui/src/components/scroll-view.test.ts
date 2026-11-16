import { describe, expect, test } from "bun:test"
import {
  canScrollKey,
  scrollKey,
  scrollOffsetFromThumbDrag,
  scrollOffsetFromThumbPointer,
  scrollTopFromThumbPointer,
} from "./scroll-view"

describe("scrollKey", () => {
  test("maps plain navigation keys", () => {
    expect(scrollKey({ key: "PageDown", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(
      "page-down",
    )
    expect(scrollKey({ key: "ArrowUp", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe("up")
  })

  test("ignores modified keybinds", () => {
    expect(
      scrollKey({ key: "ArrowDown", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false }),
    ).toBeUndefined()
    expect(scrollKey({ key: "PageUp", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBeUndefined()
    expect(scrollKey({ key: "End", altKey: false, ctrlKey: false, metaKey: false, shiftKey: true })).toBeUndefined()
  })

  test("maps space and shift-space directions", () => {
    expect(scrollKey({ key: " ", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe("page-down")
    expect(scrollKey({ key: " ", altKey: false, ctrlKey: false, metaKey: false, shiftKey: true })).toBe("page-up")
  })
})

describe("canScrollKey", () => {
  const element = (scrollTop: number, clientHeight = 100, scrollHeight = 300) =>
    ({ scrollTop, clientHeight, scrollHeight }) as HTMLElement

  test("owns upward keys only above the top boundary", () => {
    expect(canScrollKey(element(50), "page-up")).toBe(true)
    expect(canScrollKey(element(0), "page-up")).toBe(false)
  })

  test("owns downward keys only before the bottom boundary", () => {
    expect(canScrollKey(element(50), "page-down")).toBe(true)
    expect(canScrollKey(element(200), "page-down")).toBe(false)
    expect(canScrollKey(element(0, 100, 100), "page-down")).toBe(false)
  })
})

describe("scrollTopFromThumbPointer", () => {
  test("keeps downward thumb movement monotonic when content height changes", () => {
    const first = scrollTopFromThumbPointer({
      pointer: 300,
      viewportTop: 100,
      grabOffset: 12,
      clientHeight: 600,
      scrollHeight: 6_000,
      thumbHeight: 60,
    })

    const second = scrollTopFromThumbPointer({
      pointer: 320,
      viewportTop: 100,
      grabOffset: 12,
      clientHeight: 600,
      scrollHeight: 60_000,
      thumbHeight: 32,
    })

    expect(second).toBeGreaterThan(first)
  })

  test("clamps pointer positions to the scroll range", () => {
    const input = {
      viewportTop: 100,
      grabOffset: 12,
      clientHeight: 600,
      scrollHeight: 6_000,
      thumbHeight: 60,
    }

    expect(scrollTopFromThumbPointer({ ...input, pointer: 0 })).toBe(0)
    expect(scrollTopFromThumbPointer({ ...input, pointer: 1_000 })).toBe(5_400)
  })

  test("uses scrollClientHeight when the thumb track differs from the viewport", () => {
    const input = {
      pointer: 400,
      viewportTop: 100,
      grabOffset: 0,
      clientHeight: 400,
      scrollClientHeight: 800,
      scrollHeight: 8_000,
      thumbHeight: 40,
    }

    // track usable = 400 - 16 - 40 = 344; thumbTop = 400 - 100 - 8 = 292
    // maxScroll = 8000 - 800 = 7200 → 292/344 * 7200
    expect(scrollTopFromThumbPointer(input)).toBeCloseTo((292 / 344) * 7200)
  })

  test("inverts the thumb rendering when a scroll adjustment is applied", () => {
    // The thumb is rendered from scrollTop + adjustment over scrollHeight + adjustment.
    // track usable = 600 - 16 - 60 = 524; maxScroll = (6000 + 400) - 600 = 5800.
    // scrollTop 1000 renders at thumbStart = 8 + (1400 / 5800) * 524; dragging back
    // to that position must return 1000, not 1400.
    const thumbStart = 8 + (1400 / 5800) * 524

    expect(
      scrollTopFromThumbPointer({
        pointer: 100 + 12 + thumbStart,
        viewportTop: 100,
        grabOffset: 12,
        clientHeight: 600,
        scrollHeight: 6_000,
        thumbHeight: 60,
        scrollAdjustment: 400,
      }),
    ).toBeCloseTo(1000)
  })

  test("clamps the adjusted offset to the scroll range", () => {
    expect(
      scrollTopFromThumbPointer({
        pointer: 100,
        viewportTop: 100,
        grabOffset: 0,
        clientHeight: 600,
        scrollHeight: 6_000,
        thumbHeight: 60,
        scrollAdjustment: 400,
      }),
    ).toBe(0)
  })
})

describe("scrollOffsetFromThumbDrag", () => {
  // The geometry of a collapsed timeline at the grab: the native scroll height is 1700, but the
  // thumb is rendered over 1700 + 300, because a 300px scroll adjustment is still applied to the
  // rows above the viewport. The pointer is 195px into the track past the grab point:
  // progress = (195 - 8) / (500 - 16 - 121) = 187/363 of the adjusted range (2000 - 500).
  const capture = { trackSize: 500, scrollSize: 1_700, thumbSize: 121, clientSize: 500, adjustment: 300 }
  const drag = { pointer: 200, trackStart: 0, grabOffset: 5, capture }

  test("inverts the rendering mapping when the adjustment is still applied at move time", () => {
    // onBeforeScroll left the geometry alone, so the write stays in the captured system:
    // the adjusted offset (187/363 * 1500) minus the adjustment still in it.
    expect(
      scrollOffsetFromThumbDrag({ ...drag, liveAdjustment: 300, liveScrollSize: 1_700, liveClientSize: 500 }),
    ).toBeCloseTo((187 / 363) * 1500 - 300)
  })

  test("shifts by the flushed adjustment when onBeforeScroll reconciled the geometry", () => {
    // The timeline's prepareNavigation flushes the adjustment into the native offset and zeroes
    // it before the move is handled: the scroll height is whole again (2000) and the write is the
    // adjusted offset itself.
    expect(
      scrollOffsetFromThumbDrag({ ...drag, liveAdjustment: 0, liveScrollSize: 2_000, liveClientSize: 500 }),
    ).toBeCloseTo((187 / 363) * 1500)
  })

  test("keeps the pointer mapping when the content resizes during the drag", () => {
    // Rows above the viewport grew after the grab (the native height is 2600 now). The drag was
    // captured against 2000 of content, so the same pointer position still maps to the same
    // offset instead of slipping by the growth.
    expect(
      scrollOffsetFromThumbDrag({ ...drag, liveAdjustment: 0, liveScrollSize: 2_600, liveClientSize: 500 }),
    ).toBeCloseTo((187 / 363) * 1500)
  })

  test("clamps the shifted offset to the range the viewport has now", () => {
    // The content shrank below the captured range mid-drag; the write cannot pass its end.
    expect(
      scrollOffsetFromThumbDrag({
        ...drag,
        pointer: 10_000,
        liveAdjustment: 0,
        liveScrollSize: 1_200,
        liveClientSize: 500,
      }),
    ).toBe(700)
  })
})

describe("scrollOffsetFromThumbPointer", () => {
  const input = {
    viewportStart: 100,
    grabOffset: 10,
    clientSize: 400,
    scrollClientSize: 400,
    scrollSize: 1_000,
    thumbSize: 100,
  }

  test("maps horizontal pointer movement to scroll offset", () => {
    expect(scrollOffsetFromThumbPointer({ ...input, pointer: 118 })).toBe(0)
    expect(scrollOffsetFromThumbPointer({ ...input, pointer: 402 })).toBe(600)
  })

  test("reverses horizontal pointer movement for RTL", () => {
    expect(scrollOffsetFromThumbPointer({ ...input, pointer: 118, reverse: true })).toBe(600)
    expect(scrollOffsetFromThumbPointer({ ...input, pointer: 402, reverse: true })).toBe(0)
  })
})
