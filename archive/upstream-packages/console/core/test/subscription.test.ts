import { describe, expect, test, setSystemTime, afterEach } from "bun:test"
import { Subscription } from "../src/subscription"
import { centsToMicroCents } from "../src/util/price"

afterEach(() => {
  setSystemTime()
})

describe("Subscription.analyzeMonthlyUsage", () => {
  const subscribed = new Date("2026-01-15T08:00:00Z")

  test("returns ok with 0% when usage was last updated before current period", () => {
    setSystemTime(new Date("2026-03-20T10:00:00Z"))
    const result = Subscription.analyzeMonthlyUsage({
      limit: 10,
      usage: centsToMicroCents(500),
      timeUpdated: new Date("2026-02-10T00:00:00Z"),
      timeSubscribed: subscribed,
    })

    expect(result.status).toBe("ok")
    expect(result.usagePercent).toBe(0)
    // reset should be seconds until 2026-04-15T08:00:00Z
    const expected = Math.ceil(
      (new Date("2026-04-15T08:00:00Z").getTime() - new Date("2026-03-20T10:00:00Z").getTime()) / 1000,
    )
    expect(result.resetInSec).toBe(expected)
  })

  test("returns ok with usage percent when under limit", () => {
    setSystemTime(new Date("2026-03-20T10:00:00Z"))
    const limit = 10 // $10
    const half = centsToMicroCents(10 * 100) / 2
    const result = Subscription.analyzeMonthlyUsage({
      limit,
      usage: half,
      timeUpdated: new Date("2026-03-18T00:00:00Z"),
      timeSubscribed: subscribed,
    })

    expect(result.status).toBe("ok")
    expect(result.usagePercent).toBe(50)
  })

  test("returns rate-limited when at or over limit", () => {
    setSystemTime(new Date("2026-03-20T10:00:00Z"))
    const limit = 10
    const result = Subscription.analyzeMonthlyUsage({
      limit,
      usage: centsToMicroCents(limit * 100),
      timeUpdated: new Date("2026-03-18T00:00:00Z"),
      timeSubscribed: subscribed,
    })

    expect(result.status).toBe("rate-limited")
    expect(result.usagePercent).toBe(100)
  })

  test("resets usage when crossing monthly boundary", () => {
    // subscribed on 15th, now is April 16th — period is Apr 15 to May 15
    // timeUpdated is March 20 (previous period)
    setSystemTime(new Date("2026-04-16T10:00:00Z"))
    const result = Subscription.analyzeMonthlyUsage({
      limit: 10,
      usage: centsToMicroCents(10 * 100),
      timeUpdated: new Date("2026-03-20T00:00:00Z"),
      timeSubscribed: subscribed,
    })

    expect(result.status).toBe("ok")
    expect(result.usagePercent).toBe(0)
  })

  test("caps usage percent at 100", () => {
    setSystemTime(new Date("2026-03-20T10:00:00Z"))
    const limit = 10
    const result = Subscription.analyzeMonthlyUsage({
      limit,
      usage: centsToMicroCents(limit * 100) - 1,
      timeUpdated: new Date("2026-03-18T00:00:00Z"),
      timeSubscribed: subscribed,
    })

    expect(result.status).toBe("ok")
    expect(result.usagePercent).toBeLessThanOrEqual(100)
  })

  test("handles subscription day 31 in short month", () => {
    const sub31 = new Date("2026-01-31T12:00:00Z")
    // now is March 1 — period should be Feb 28 to Mar 31
    setSystemTime(new Date("2026-03-01T10:00:00Z"))
    const result = Subscription.analyzeMonthlyUsage({
      limit: 10,
      usage: 0,
      timeUpdated: new Date("2026-03-01T09:00:00Z"),
      timeSubscribed: sub31,
    })

    expect(result.status).toBe("ok")
    expect(result.usagePercent).toBe(0)
    const expected = Math.ceil(
      (new Date("2026-03-31T12:00:00Z").getTime() - new Date("2026-03-01T10:00:00Z").getTime()) / 1000,
    )
    expect(result.resetInSec).toBe(expected)
  })
})
