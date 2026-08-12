import { describe, expect, test } from "bun:test"
import { marqueeCycleWidth, marqueeText } from "../../src/util/marquee"
import { stringWidth } from "../../src/util/string-width"

describe("marquee text", () => {
  test("keeps short text stationary", () => {
    expect(marqueeText("Short", 10, 8)).toBe("Short")
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

  test("clips wide graphemes to terminal cells", () => {
    const frame = marqueeText("Plan 🧭 the release", 8, 5)
    expect(frame).toBe("🧭 the r")
    expect(stringWidth(frame)).toBeLessThanOrEqual(8)
  })
})
