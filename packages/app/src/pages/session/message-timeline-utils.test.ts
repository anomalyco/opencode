import { describe, expect, test } from "bun:test"
import { itemStyle, virtualize } from "./message-timeline-utils"

describe("message timeline helpers", () => {
  test("keeps virtualization off while a turn is still working", () => {
    expect(
      virtualize({
        desktop: true,
        count: 12,
        working: true,
      }),
    ).toBe(false)
  })

  test("virtualizes large idle desktop timelines", () => {
    expect(
      virtualize({
        desktop: true,
        count: 12,
        working: false,
      }),
    ).toBe(true)
  })

  test("keeps centered item layout without intrinsic size shortcuts", () => {
    const style = itemStyle(true)

    expect(style["max-width"]).toBe("var(--session-content-width, 60rem)")
    expect(style["margin-left"]).toBe("auto")
    expect(style["margin-right"]).toBe("auto")
    expect(style["content-visibility"]).toBeUndefined()
    expect(style["contain-intrinsic-size"]).toBeUndefined()
  })
})
