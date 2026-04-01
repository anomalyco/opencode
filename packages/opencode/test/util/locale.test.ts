import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("Locale.duration", () => {
  test("formats milliseconds", () => {
    expect(Locale.duration(0)).toBe("0ms")
    expect(Locale.duration(500)).toBe("500ms")
    expect(Locale.duration(999)).toBe("999ms")
  })

  test("formats seconds", () => {
    expect(Locale.duration(1000)).toBe("1.0s")
    expect(Locale.duration(1500)).toBe("1.5s")
    expect(Locale.duration(59999)).toBe("60.0s")
  })

  test("formats minutes and seconds", () => {
    expect(Locale.duration(60000)).toBe("1m 0s")
    expect(Locale.duration(90000)).toBe("1m 30s")
    expect(Locale.duration(3599999)).toBe("59m 59s")
  })

  test("formats hours and minutes", () => {
    expect(Locale.duration(3600000)).toBe("1h 0m")
    expect(Locale.duration(5400000)).toBe("1h 30m")
    expect(Locale.duration(86399999)).toBe("23h 59m")
  })

  test("formats days and hours", () => {
    expect(Locale.duration(86400000)).toBe("1d 0h")
    expect(Locale.duration(90000000)).toBe("1d 1h")
    expect(Locale.duration(172800000)).toBe("2d 0h")
    expect(Locale.duration(180000000)).toBe("2d 2h")
  })
})

describe("Locale.number", () => {
  test("formats small numbers", () => {
    expect(Locale.number(0)).toBe("0")
    expect(Locale.number(999)).toBe("999")
  })

  test("formats thousands", () => {
    expect(Locale.number(1000)).toBe("1.0K")
    expect(Locale.number(1500)).toBe("1.5K")
  })

  test("formats millions", () => {
    expect(Locale.number(1000000)).toBe("1.0M")
    expect(Locale.number(2500000)).toBe("2.5M")
  })
})

describe("Locale.truncate", () => {
  test("returns short strings unchanged", () => {
    expect(Locale.truncate("abc", 5)).toBe("abc")
  })

  test("truncates long strings with ellipsis", () => {
    expect(Locale.truncate("abcdef", 4)).toBe("abc…")
  })
})

describe("Locale.pluralize", () => {
  test("uses singular for count 1", () => {
    expect(Locale.pluralize(1, "{} file", "{} files")).toBe("1 file")
  })

  test("uses plural for other counts", () => {
    expect(Locale.pluralize(0, "{} file", "{} files")).toBe("0 files")
    expect(Locale.pluralize(5, "{} file", "{} files")).toBe("5 files")
  })
})
