import { describe, expect, test } from "bun:test"
import { getRetryAfterDay, getRetryAfterHour } from "../src/routes/zen/util/rateLimiter"

describe("getRetryAfterDay", () => {
  test("returns full day at midnight UTC", () => {
    const midnight = Date.UTC(2026, 0, 15, 0, 0, 0, 0)
    expect(getRetryAfterDay(midnight)).toBe(86_400)
  })

  test("returns remaining seconds until next UTC day", () => {
    const noon = Date.UTC(2026, 0, 15, 12, 0, 0, 0)
    expect(getRetryAfterDay(noon)).toBe(43_200)
  })

  test("rounds up to nearest second", () => {
    const almost = Date.UTC(2026, 0, 15, 23, 59, 59, 500)
    expect(getRetryAfterDay(almost)).toBe(1)
  })
})

describe("getRetryAfterHour", () => {
  // 14:30:00 UTC — 30 minutes into the current hour
  const now = Date.UTC(2026, 0, 15, 14, 30, 0, 0)
  const intervals = ["2026011514", "2026011513", "2026011512"]

  test("waits 3 hours when all usage is in current hour", () => {
    const rows = [{ interval: "2026011514", count: 10 }]
    // only current hour has usage — it won't leave the window for 3 hours from hour start
    // 3 * 3600 - 1800 = 9000s
    expect(getRetryAfterHour(rows, intervals, 10, now)).toBe(9000)
  })

  test("waits 1 hour when dropping oldest interval is sufficient", () => {
    const rows = [
      { interval: "2026011514", count: 2 },
      { interval: "2026011512", count: 10 },
    ]
    // total=12, drop oldest (-2h, count=10) -> 2 < 10
    // hours = 3 - 2 = 1 -> 1 * 3600 - 1800 = 1800s
    expect(getRetryAfterHour(rows, intervals, 10, now)).toBe(1800)
  })

  test("waits 2 hours when usage spans oldest two intervals", () => {
    const rows = [
      { interval: "2026011513", count: 8 },
      { interval: "2026011512", count: 5 },
    ]
    // total=13, drop -2h (5) -> 8, 8 >= 8, drop -1h (8) -> 0 < 8
    // hours = 3 - 1 = 2 -> 2 * 3600 - 1800 = 5400s
    expect(getRetryAfterHour(rows, intervals, 8, now)).toBe(5400)
  })

  test("waits 1 hour when oldest interval alone pushes over limit", () => {
    const rows = [
      { interval: "2026011514", count: 1 },
      { interval: "2026011513", count: 1 },
      { interval: "2026011512", count: 10 },
    ]
    // total=12, drop -2h (10) -> 2 < 10
    // hours = 3 - 2 = 1 -> 1800s
    expect(getRetryAfterHour(rows, intervals, 10, now)).toBe(1800)
  })

  test("waits 2 hours when middle interval keeps total over limit", () => {
    const rows = [
      { interval: "2026011514", count: 4 },
      { interval: "2026011513", count: 4 },
      { interval: "2026011512", count: 4 },
    ]
    // total=12, drop -2h (4) -> 8, 8 >= 5, drop -1h (4) -> 4 < 5
    // hours = 3 - 1 = 2 -> 5400s
    expect(getRetryAfterHour(rows, intervals, 5, now)).toBe(5400)
  })

  test("rounds up to nearest second", () => {
    const offset = Date.UTC(2026, 0, 15, 14, 30, 0, 500)
    const rows = [
      { interval: "2026011514", count: 2 },
      { interval: "2026011512", count: 10 },
    ]
    // hours=1 -> 3_600_000 - 1_800_500 = 1_799_500ms -> ceil(1799.5) = 1800
    expect(getRetryAfterHour(rows, intervals, 10, offset)).toBe(1800)
  })

  test("fallback returns time until next hour when rows are empty", () => {
    // edge case: rows empty but function called (shouldn't happen in practice)
    // loop drops all zeros, running stays 0 which is < any positive limit on first iteration
    const rows: { interval: string; count: number }[] = []
    // drop -2h (0) -> 0 < 1 -> hours = 3 - 2 = 1 -> 1800s
    expect(getRetryAfterHour(rows, intervals, 1, now)).toBe(1800)
  })
})
