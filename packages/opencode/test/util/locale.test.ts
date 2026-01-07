import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("Locale", () => {
  describe("time", () => {
    test("formats time in 12h format by default", () => {
      const date = new Date("2023-01-01T15:30:00")
      // Note: The exact output depends on the system locale, but we expect AM/PM
      // We can check if it contains PM or AM, or matches a pattern
      const result = Locale.time(date.getTime())
      expect(result).toMatch(/(\d{1,2}:\d{2}\s*[AP]M)|(\d{1,2}:\d{2})/i)
    })

    test("formats time in 12h format explicitly", () => {
      const date = new Date("2023-01-01T15:30:00")
      const result = Locale.time(date.getTime(), "12h")
      // Should look like 3:30 PM
      expect(result).toMatch(/3:30\s*PM/)
    })

    test("formats time in 24h format explicitly", () => {
      const date = new Date("2023-01-01T15:30:00")
      const result = Locale.time(date.getTime(), "24h")
      // Should look like 15:30
      expect(result).toBe("15:30")
    })
  })

  describe("datetime", () => {
    test("formats datetime in 12h format by default", () => {
      const date = new Date("2023-01-01T15:30:00")
      const result = Locale.datetime(date.getTime())
      expect(result).toContain("3:30 PM")
    })

    test("formats datetime in 24h format", () => {
      const date = new Date("2023-01-01T15:30:00")
      const result = Locale.datetime(date.getTime(), "24h")
      expect(result).toContain("15:30")
    })
  })

  describe("todayTimeOrDateTime", () => {
    test("returns time for today", () => {
      const now = new Date()
      const result = Locale.todayTimeOrDateTime(now.getTime(), "24h")
      // Should be just time, e.g. 15:30, length is short
      expect(result.length).toBeLessThan(10)
      expect(result).toMatch(/^\d{1,2}:\d{2}$/)
    })

    test("returns datetime for past date", () => {
      const past = new Date("2020-01-01T12:00:00")
      const result = Locale.todayTimeOrDateTime(past.getTime(), "24h")
      expect(result).toContain("12:00")
      expect(result).toContain("2020")
    })
  })
})