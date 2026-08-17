import { describe, expect, test } from "bun:test"
import { marqueeCycleWidth, marqueeOverflows, marqueeText, marqueeTextParts } from "../../src/util/marquee"
import { stringWidth } from "../../src/util/string-width"

describe("marquee text", () => {
  test("keeps short text stationary", () => {
    expect(marqueeText("Short", 10, 8)).toBe("Short")
  })

  test("does not classify an exact fit as overflow", () => {
    expect(marqueeOverflows("Exact fit", 9)).toBe(false)
    expect(marqueeOverflows("Exact fit", 8)).toBe(true)
  })

  test("starts clipped and scrolls through a long title", () => {
    expect(marqueeText("A long session title", 8, 0)).toBe("A long s")
    expect(marqueeText("A long session title", 8, 2)).toBe("long ses")
    expect(marqueeText("A long session title", 8, 15)).toBe("title · ")
    expect(marqueeText("A long session title", 8, 20)).toBe(" · A lon")
  })

  test("loops after one spaced dot separator", () => {
    const title = "A long session title"
    expect(marqueeText(title, 8, marqueeCycleWidth(title) - 3)).toBe(" · A lon")
    expect(marqueeText(title, 8, marqueeCycleWidth(title))).toBe("A long s")
  })

  test("identifies only the generated separator dot", () => {
    expect(marqueeTextParts("A · title", 6, 7)).toEqual([
      { value: "l", separator: false },
      { value: "e", separator: false },
      { value: " ", separator: false },
      { value: "·", separator: true },
      { value: " ", separator: false },
      { value: "A", separator: false },
    ])
    expect(marqueeTextParts("A · title", 6, 2)[0]).toEqual({ value: "·", separator: false })
  })

  test("clips wide graphemes to terminal cells", () => {
    const frame = marqueeText("Plan 🧭 the release", 8, 5)
    expect(frame).toBe("🧭 the r")
    expect(stringWidth(frame)).toBeLessThanOrEqual(8)
  })
})
