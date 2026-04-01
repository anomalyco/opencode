import { test, expect } from "bun:test"
import { CronParser } from "../../src/scheduler/cron-parser"

test("parse standard cron fields", () => {
  const result = CronParser.parse("0 12 1 1 1")
  expect(result.minute).toEqual([0])
  expect(result.hour).toEqual([12])
  expect(result.dayOfMonth).toEqual([1])
  expect(result.month).toEqual([1])
  expect(result.dayOfWeek).toEqual([1])
})

test("parse wildcard", () => {
  const result = CronParser.parse("* * * * *")
  expect(result.minute.length).toBeGreaterThan(50)
  expect(result.hour.length).toBe(24)
  expect(result.dayOfMonth.length).toBe(31)
  expect(result.month.length).toBe(12)
  expect(result.dayOfWeek.length).toBe(7)
})

test("parse ranges", () => {
  const result = CronParser.parse("0-10 9-17 * * *")
  expect(result.minute).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(result.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
})

test("parse steps", () => {
  const result = CronParser.parse("*/15 */4 * * *")
  expect(result.minute).toEqual([0, 15, 30, 45])
  expect(result.hour).toEqual([0, 4, 8, 12, 16, 20])
})

test("parse comma-separated values", () => {
  const result = CronParser.parse("0,30 9,12,17 1,15 * *")
  expect(result.minute).toEqual([0, 30])
  expect(result.hour).toEqual([9, 12, 17])
  expect(result.dayOfMonth).toEqual([1, 15])
})

test("nextRun returns the next scheduled time", () => {
  const expr = CronParser.parse("0 12 * * *")
  const after = new Date("2024-01-01T00:00:00Z").getTime()
  const next = CronParser.nextRun(expr, after)
  const expected = new Date("2024-01-01T12:00:00Z").getTime()
  expect(next).toBe(expected)
})

test("nextRun for daily at 2am", () => {
  const expr = CronParser.parse("0 2 * * *")
  const after = new Date("2024-01-01T03:00:00Z").getTime()
  const next = CronParser.nextRun(expr, after)
  // Should be next day at 2am
  const expected = new Date("2024-01-02T02:00:00Z").getTime()
  expect(next).toBe(expected)
})

test("isValid rejects invalid expressions", () => {
  expect(CronParser.isValid("0 12 * * *")).toBe(true)
  expect(CronParser.isValid("* * * * *")).toBe(true)
  expect(CronParser.isValid("invalid")).toBe(false)
  expect(CronParser.isValid("0 12")).toBe(false)
  expect(CronParser.isValid("99 99 * * *")).toBe(false)
})

test("humanReadable describes the schedule", () => {
  expect(CronParser.humanReadable("0 */4 * * *")).toContain("every 4 hours")
  expect(CronParser.humanReadable("0 2 * * *")).toContain("2:00 AM")
  expect(CronParser.humanReadable("*/30 * * * *")).toContain("every 30 minutes")
})
