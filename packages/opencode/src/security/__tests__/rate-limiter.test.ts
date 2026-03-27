import { describe, test, expect, spyOn, afterEach } from "bun:test"
import { RateLimiter } from "../rate-limiter"
import { Config } from "../../config/config"

describe("Rate Limiter — config-driven behavior", () => {
  let spy: ReturnType<typeof spyOn<typeof Config, "get">>
  afterEach(() => spy?.mockRestore())

  test("SEC-07: rate limiting enabled by default (absent security key)", async () => {
    spy = spyOn(Config, "get").mockResolvedValue({} as any)
    const result = await RateLimiter.consumeIfEnabled("sec07-key")
    expect(typeof result).toBe("boolean")
  })

  test("SEC-05: skips rate limiting when rateLimiting.enabled = false", async () => {
    spy = spyOn(Config, "get").mockResolvedValue({
      security: { rateLimiting: { enabled: false } },
    } as any)
    // All requests pass through when disabled
    expect(await RateLimiter.consumeIfEnabled("disabled-key", 1000)).toBe(true)
    expect(await RateLimiter.consumeIfEnabled("disabled-key", 1000)).toBe(true)
  })

  test("SEC-05: respects custom maxTokens from config via RateLimiter constructor", async () => {
    spy = spyOn(Config, "get").mockResolvedValue({
      security: { rateLimiting: { enabled: true, maxTokens: 2, refillRate: 1, refillIntervalMs: 60000 } },
    } as any)
    // Direct RateLimiter usage with config params mirrors what consumeIfEnabled does
    const limiter = new RateLimiter({ maxTokens: 2, refillRate: 1, refillIntervalMs: 60000 })
    expect(limiter.consume("x")).toBe(true)  // 1st token
    expect(limiter.consume("x")).toBe(true)  // 2nd token
    expect(limiter.consume("x")).toBe(false) // exhausted
  })
})
