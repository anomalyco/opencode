import { describe, expect, test } from "bun:test"
import { cacheHitRate } from "./session-context-format"

describe("cacheHitRate", () => {
  test("returns null when nothing was sent", () => {
    expect(cacheHitRate(0, 0)).toBeNull()
  })

  test("returns 100 when every input token was cached", () => {
    expect(cacheHitRate(4096, 0)).toBe(100)
  })

  test("returns 0 when no token was cached", () => {
    expect(cacheHitRate(0, 4096)).toBe(0)
  })

  test("rounds the read share of input-side tokens", () => {
    expect(cacheHitRate(3000, 1000)).toBe(75)
    expect(cacheHitRate(2, 1)).toBe(67)
  })

  test("ignores negative totals", () => {
    expect(cacheHitRate(-1, -1)).toBeNull()
  })
})
