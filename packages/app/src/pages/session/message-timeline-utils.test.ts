import { describe, expect, test } from "bun:test"
import { itemStyle, timelineHeightCacheEnabled, timelineVirtualizationEnabled } from "./message-timeline-utils"

describe("message timeline helpers", () => {
  test("keeps centered item layout without intrinsic size shortcuts", () => {
    const style = itemStyle(true)

    expect(style["max-width"]).toBe("var(--session-content-width, 60rem)")
    expect(style["margin-left"]).toBe("auto")
    expect(style["margin-right"]).toBe("auto")
    expect(style["content-visibility"]).toBeUndefined()
    expect(style["contain-intrinsic-size"]).toBeUndefined()
  })

  test("keeps timeline virtualization opt-in", () => {
    expect(timelineVirtualizationEnabled(null)).toBe(false)
    expect(timelineVirtualizationEnabled(undefined)).toBe(false)
    expect(timelineVirtualizationEnabled("0")).toBe(false)
    expect(timelineVirtualizationEnabled("1")).toBe(true)
  })

  test("keeps timeline height cache opt-in", () => {
    expect(timelineHeightCacheEnabled(null)).toBe(false)
    expect(timelineHeightCacheEnabled(undefined)).toBe(false)
    expect(timelineHeightCacheEnabled("0")).toBe(false)
    expect(timelineHeightCacheEnabled("1")).toBe(true)
  })
})
