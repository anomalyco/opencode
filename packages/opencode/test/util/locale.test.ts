import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("Locale.duration", () => {
  test("returns milliseconds for values under 1 second", () => {
    expect(Locale.duration(0)).toBe("0ms")
    expect(Locale.duration(500)).toBe("500ms")
    expect(Locale.duration(999)).toBe("999ms")
  })

  test("returns seconds with decimals by default", () => {
    expect(Locale.duration(1000)).toBe("1.0s")
    expect(Locale.duration(1500)).toBe("1.5s")
    expect(Locale.duration(30000)).toBe("30.0s")
    expect(Locale.duration(59999)).toBe("60.0s")
  })

  test("returns seconds without decimals when decimalSeconds: false", () => {
    expect(Locale.duration(1000, { decimalSeconds: false })).toBe("1s")
    expect(Locale.duration(1500, { decimalSeconds: false })).toBe("1s")
    expect(Locale.duration(30000, { decimalSeconds: false })).toBe("30s")
    expect(Locale.duration(59999, { decimalSeconds: false })).toBe("59s")
  })

  test("returns minutes and seconds for values under 1 hour", () => {
    expect(Locale.duration(60000)).toBe("1m 0s")
    expect(Locale.duration(90000)).toBe("1m 30s")
    expect(Locale.duration(2700000)).toBe("45m 0s")
    expect(Locale.duration(2730000)).toBe("45m 30s")
  })

  test("returns hours and minutes for values under 1 day", () => {
    expect(Locale.duration(3600000)).toBe("1h 0m")
    expect(Locale.duration(5400000)).toBe("1h 30m")
    expect(Locale.duration(7200000)).toBe("2h 0m")
    expect(Locale.duration(7260000)).toBe("2h 1m")
  })

  test("returns days and hours for values 1 day or more", () => {
    expect(Locale.duration(86400000)).toBe("1d 0h")
    expect(Locale.duration(90000000)).toBe("1d 1h")
    expect(Locale.duration(172800000)).toBe("2d 0h")
  })
})
