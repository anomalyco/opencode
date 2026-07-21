import { describe, expect, test } from "bun:test"
import { canScrollKey, scrollKey, scrollTopFromThumbPointer } from "./scroll-view"

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
})
