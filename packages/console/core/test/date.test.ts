import { describe, expect, test } from "bun:test"
import { getWeekBounds, getMonthlyBounds } from "../src/util/date"

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

describe("util.date.getMonthlyBounds", () => {
  test("resets on subscription day mid-month", () => {
    const now = new Date("2026-03-20T10:00:00Z")
    const subscribed = new Date("2026-01-15T08:00:00Z")
    const bounds = getMonthlyBounds(now, subscribed)

    expect(bounds.start.toISOString()).toBe("2026-03-15T08:00:00.000Z")
    expect(bounds.end.toISOString()).toBe("2026-04-15T08:00:00.000Z")
  })

  test("before subscription day in current month uses previous month anchor", () => {
    const now = new Date("2026-03-10T10:00:00Z")
    const subscribed = new Date("2026-01-15T08:00:00Z")
    const bounds = getMonthlyBounds(now, subscribed)

    expect(bounds.start.toISOString()).toBe("2026-02-15T08:00:00.000Z")
    expect(bounds.end.toISOString()).toBe("2026-03-15T08:00:00.000Z")
  })

  test("clamps day for short months", () => {
    const now = new Date("2026-03-01T10:00:00Z")
    const subscribed = new Date("2026-01-31T12:00:00Z")
    const bounds = getMonthlyBounds(now, subscribed)

    expect(bounds.start.toISOString()).toBe("2026-02-28T12:00:00.000Z")
    expect(bounds.end.toISOString()).toBe("2026-03-31T12:00:00.000Z")
  })

  test("handles subscription on the 1st", () => {
    const now = new Date("2026-04-15T00:00:00Z")
    const subscribed = new Date("2026-01-01T00:00:00Z")
    const bounds = getMonthlyBounds(now, subscribed)

    expect(bounds.start.toISOString()).toBe("2026-04-01T00:00:00.000Z")
    expect(bounds.end.toISOString()).toBe("2026-05-01T00:00:00.000Z")
  })

  test("exactly on the reset boundary uses current period", () => {
    const now = new Date("2026-03-15T08:00:00Z")
    const subscribed = new Date("2026-01-15T08:00:00Z")
    const bounds = getMonthlyBounds(now, subscribed)

    expect(bounds.start.toISOString()).toBe("2026-03-15T08:00:00.000Z")
    expect(bounds.end.toISOString()).toBe("2026-04-15T08:00:00.000Z")
  })

  test("february to march with day 30 subscription", () => {
    const now = new Date("2026-02-15T06:00:00Z")
    const subscribed = new Date("2025-12-30T06:00:00Z")
    const bounds = getMonthlyBounds(now, subscribed)

    expect(bounds.start.toISOString()).toBe("2026-01-30T06:00:00.000Z")
    expect(bounds.end.toISOString()).toBe("2026-02-28T06:00:00.000Z")
  })
})
