import { describe, expect, test } from "bun:test"
import { reconnectBackoffMs, reconnectEnsureSpreadMs } from "../../../src/context/client"

describe("managed reconnect herd timing", () => {
  test("ensure spread stays within jitter bounds and desynchronizes samples", () => {
    const samples = Array.from({ length: 64 }, (_, i) => reconnectEnsureSpreadMs(() => i / 64))
    expect(Math.min(...samples)).toBe(0)
    expect(Math.max(...samples)).toBeLessThan(500)
    expect(new Set(samples).size).toBeGreaterThan(1)
  })

  test("post-ensure backoff stays in [1000, 1500)", () => {
    const samples = Array.from({ length: 64 }, (_, i) => reconnectBackoffMs(() => i / 64))
    expect(Math.min(...samples)).toBe(1000)
    expect(Math.max(...samples)).toBeLessThan(1500)
    expect(new Set(samples).size).toBeGreaterThan(1)
  })
})
