import { describe, expect, test } from "bun:test"
import { itemStyle } from "./message-timeline-utils"

describe("message timeline helpers", () => {
  test("keeps centered item layout without intrinsic size shortcuts", () => {
    const style = itemStyle(true)

    expect(style["max-width"]).toBe("var(--session-content-width, 60rem)")
    expect(style["margin-left"]).toBe("auto")
    expect(style["margin-right"]).toBe("auto")
    expect(style["content-visibility"]).toBeUndefined()
    expect(style["contain-intrinsic-size"]).toBeUndefined()
  })
})
