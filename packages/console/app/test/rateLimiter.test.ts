import { describe, expect, test } from "bun:test"
import { getRetryAfterDay } from "../src/routes/zen/util/ipRateLimiter"

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
