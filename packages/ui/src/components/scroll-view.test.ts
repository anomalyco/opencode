import { describe, expect, test } from "bun:test"
import { scrollKey, scrollTopFromThumbPointer } from "./scroll-view"

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
})
