import { describe, expect, test } from "bun:test"
import {
  getTimestampsMode,
  hourMinute,
  hourMinuteSecond,
  nextTimestampsMode,
  normalizeTimestampsMode,
  TIMESTAMPS_MODES,
} from "@/cli/cmd/tui/util/timestamps"

describe("getTimestampsMode", () => {
  test("returns 'hide' when config is undefined", () => {
    expect(getTimestampsMode(undefined)).toBe("hide")
  })

  test("returns 'hide' when timestamps_mode is missing", () => {
    expect(getTimestampsMode({})).toBe("hide")
  })

  test("returns the configured value when present", () => {
    expect(getTimestampsMode({ timestamps_mode: "footer" })).toBe("footer")
    expect(getTimestampsMode({ timestamps_mode: "gutter" })).toBe("gutter")
    expect(getTimestampsMode({ timestamps_mode: "hide" })).toBe("hide")
  })
})

describe("nextTimestampsMode", () => {
  test("cycles hide → footer → gutter → hide", () => {
    expect(nextTimestampsMode("hide")).toBe("footer")
    expect(nextTimestampsMode("footer")).toBe("gutter")
    expect(nextTimestampsMode("gutter")).toBe("hide")
  })

  test("covers every declared mode exactly once per full cycle", () => {
    const seen = new Set<string>()
    let current = TIMESTAMPS_MODES[0]
    for (let i = 0; i < TIMESTAMPS_MODES.length; i++) {
      seen.add(current)
      current = nextTimestampsMode(current)
    }
    expect(seen.size).toBe(TIMESTAMPS_MODES.length)
    expect(current).toBe(TIMESTAMPS_MODES[0])
  })
})

describe("normalizeTimestampsMode", () => {
  test("maps legacy 'show' to 'footer'", () => {
    expect(normalizeTimestampsMode("show", "hide")).toBe("footer")
  })

  test("passes through valid modes", () => {
    expect(normalizeTimestampsMode("hide", "footer")).toBe("hide")
    expect(normalizeTimestampsMode("footer", "hide")).toBe("footer")
    expect(normalizeTimestampsMode("gutter", "hide")).toBe("gutter")
  })

  test("falls back for unknown values", () => {
    expect(normalizeTimestampsMode(undefined, "hide")).toBe("hide")
    expect(normalizeTimestampsMode(null, "footer")).toBe("footer")
    expect(normalizeTimestampsMode("bogus", "gutter")).toBe("gutter")
    expect(normalizeTimestampsMode(42, "hide")).toBe("hide")
  })
})

describe("hourMinute", () => {
  test("returns a 5-cell HH:MM string", () => {
    // 2025-01-02T07:05:00 local — exact components depend on tz, but length is fixed.
    const ms = new Date(2025, 0, 2, 7, 5, 0).getTime()
    const out = hourMinute(ms)
    expect(out).toHaveLength(5)
    expect(out).toMatch(/^\d{2}:\d{2}$/)
  })

  test("pads single-digit hours and minutes", () => {
    const ms = new Date(2025, 0, 2, 3, 9, 0).getTime()
    expect(hourMinute(ms)).toBe("03:09")
  })

  test("uses 24-hour clock", () => {
    const ms = new Date(2025, 0, 2, 23, 45, 0).getTime()
    expect(hourMinute(ms)).toBe("23:45")
  })
})

describe("hourMinuteSecond", () => {
  test("returns 8-cell HH:MM:SS, zero-padded, 24-hour", () => {
    const ms = new Date(2025, 0, 2, 7, 5, 9).getTime()
    expect(hourMinuteSecond(ms)).toBe("07:05:09")
  })

  test("23:59:59 boundary", () => {
    const ms = new Date(2025, 0, 2, 23, 59, 59).getTime()
    expect(hourMinuteSecond(ms)).toBe("23:59:59")
  })

  test("midnight", () => {
    const ms = new Date(2025, 0, 2, 0, 0, 0).getTime()
    expect(hourMinuteSecond(ms)).toBe("00:00:00")
  })
})
