import { describe, expect, test } from "bun:test"
import { getWeekBounds } from "./date"

describe("util.date.getWeekBounds", () => {
  test("returns a Monday-based week for Sunday dates", () => {
    const date = new Date("2026-01-18T12:00:00Z")
    const bounds = getWeekBounds(date)

    expect(bounds.start.toISOString()).toBe("2026-01-12T00:00:00.000Z")
    expect(bounds.end.toISOString()).toBe("2026-01-19T00:00:00.000Z")
  })

  test("returns a seven day window", () => {
    const date = new Date("2026-01-14T12:00:00Z")
    const bounds = getWeekBounds(date)

    const span = bounds.end.getTime() - bounds.start.getTime()
    expect(span).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
