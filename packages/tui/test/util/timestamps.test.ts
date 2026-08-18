import { describe, expect, test } from "bun:test"
import { todayTimeOrDateTime, time, datetime } from "../../src/util/locale"

describe("locale timestamps for assistant messages", () => {
  test("todayTimeOrDateTime returns short time for today", () => {
    const now = Date.now()
    const result = todayTimeOrDateTime(now)
    expect(result).toMatch(/\d/)
  })

  test("todayTimeOrDateTime returns date+time for past date", () => {
    const past = new Date(2020, 0, 1).getTime()
    const result = todayTimeOrDateTime(past)
    expect(result).toContain("·")
  })

  test("time returns a short time string", () => {
    const ts = new Date(2026, 7, 18, 13, 34, 25).getTime()
    const result = time(ts)
    expect(result).toMatch(/1:34/)
  })

  test("datetime includes both time and date", () => {
    const ts = new Date(2026, 7, 18, 13, 34, 25).getTime()
    const result = datetime(ts)
    expect(result).toContain("·")
    expect(result).toMatch(/1:34/)
  })
})
