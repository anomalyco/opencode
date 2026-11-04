import { describe, expect, test } from "bun:test"
import { duration } from "./duration.js"

describe("duration", () => {
  test("renders elapsed time below one second in milliseconds", () => {
    expect(duration(0)).toBe("0ms")
    expect(duration(1)).toBe("1ms")
    expect(duration(999)).toBe("999ms")
  })

  test("renders seconds with one decimal below one minute", () => {
    expect(duration(1000)).toBe("1.0s")
    expect(duration(12_400)).toBe("12.4s")
    expect(duration(59_999)).toBe("60.0s")
  })

  test("renders minutes and seconds below one hour", () => {
    expect(duration(60_000)).toBe("1m 0s")
    expect(duration(185_000)).toBe("3m 5s")
    expect(duration(3_599_999)).toBe("59m 59s")
  })

  test("renders hours and minutes below one day", () => {
    expect(duration(3_600_000)).toBe("1h 0m")
    expect(duration(7_800_000)).toBe("2h 10m")
    expect(duration(86_399_999)).toBe("23h 59m")
  })

  test("renders days and hours from one day upwards", () => {
    expect(duration(86_400_000)).toBe("1d 0h")
    expect(duration(100_800_000)).toBe("1d 4h")
    expect(duration(86_400_000 * 400)).toBe("400d 0h")
  })

  test("truncates partial units instead of rounding them", () => {
    expect(duration(59_999)).toBe("60.0s")
    expect(duration(119_999)).toBe("1m 59s")
    expect(duration(3_599_999)).toBe("59m 59s")
    expect(duration(86_399_999)).toBe("23h 59m")
  })

  test("handles negative input as sub-second milliseconds", () => {
    expect(duration(-1)).toBe("-1ms")
  })
})
