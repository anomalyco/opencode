import { describe, expect, test } from "bun:test"
import { todayTimeOrDateTime, time, datetime } from "../../src/util/locale"

describe("util.locale", () => {
  describe("todayTimeOrDateTime", () => {
    test("returns short time for today", () => {
      const now = Date.now()
      const result = todayTimeOrDateTime(now)
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })

    test("returns date+time for past date", () => {
      const past = new Date(2020, 0, 1).getTime()
      const result = todayTimeOrDateTime(past)
      expect(result).toContain("·")
    })
  })

  describe("time", () => {
    test("returns a short time string", () => {
      const ts = new Date(2026, 7, 18, 13, 34, 25).getTime()
      const result = time(ts)
      expect(result).toMatch(/\d{1,2}:34/)
    })
  })

  describe("datetime", () => {
    test("includes both time and date", () => {
      const ts = new Date(2026, 7, 18, 13, 34, 25).getTime()
      const result = datetime(ts)
      expect(result).toContain("·")
      expect(result).toMatch(/\d{1,2}:34/)
    })
  })
})
