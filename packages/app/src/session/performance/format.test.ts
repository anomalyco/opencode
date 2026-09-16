import { describe, expect, test } from "bun:test"
import { createPerformanceFormatter } from "./format"

const format = createPerformanceFormatter("en-US")

describe("createPerformanceFormatter", () => {
  test("formats durations with localized units", () => {
    expect(format.duration(842)).toBe("842 ms")
    expect(format.duration(3200)).toBe("3.2 sec")
    expect(format.duration(72000)).toBe("1.2 min")
  })
})
