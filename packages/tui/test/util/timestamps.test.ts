import { describe, expect, test } from "bun:test"
import { todayTimeOrDateTime, time, datetime } from "../../src/util/locale"

describe("util.locale", () => {
  describe("todayTimeOrDateTime", () => {
    test("returns short time for today", () => {
      const now = new Date()
      now.setHours(14, 30, 0, 0)
      const result = todayTimeOrDateTime(now.getTime())
      expect(result).toMatch(/\d{1,2}:30/)
    })

    test("returns date+time for past date", () => {
      const past = new Date(2020, 0, 1, 14, 30, 0).getTime()
      const result = todayTimeOrDateTime(past)
      expect(result).toMatch(/\d{1,2}:30/)
      expect(result.length).toBeGreaterThan(5)
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
      expect(result).toMatch(/\d{1,2}:34/)
      expect(result.length).toBeGreaterThan(5)
    })
  })
})
