import { describe, expect, test } from "bun:test"
import { SessionRetry } from "../../src/session/retry"
import { MessageV2 } from "../../src/session/message-v2"

function apiError(headers?: Record<string, string>, statusCode?: number): MessageV2.APIError {
  return new MessageV2.APIError({
    message: "boom",
    isRetryable: true,
    responseHeaders: headers,
    statusCode,
  }).toObject() as MessageV2.APIError
}

describe("session.retry.delay", () => {
  test("caps delay at 30 seconds when headers missing (with jitter)", () => {
    const error = apiError()
    const delays = Array.from({ length: 10 }, (_, index) => SessionRetry.delay(index + 1, error))

    // With jitter (10%), delays should be within ±10% of expected values
    const expectedBase = [2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000]
    delays.forEach((delay, i) => {
      const expected = expectedBase[i]
      const minDelay = expected * 0.9
      const maxDelay = expected * 1.1
      expect(delay).toBeGreaterThanOrEqual(minDelay)
      expect(delay).toBeLessThanOrEqual(maxDelay)
    })
  })

  test("prefers retry-after-ms when shorter than exponential (with jitter)", () => {
    const error = apiError({ "retry-after-ms": "1500" })
    const delay = SessionRetry.delay(4, error)
    // Should be within ±10% of 1500ms
    expect(delay).toBeGreaterThanOrEqual(1350)
    expect(delay).toBeLessThanOrEqual(1650)
  })

  test("uses retry-after seconds when reasonable (with jitter)", () => {
    const error = apiError({ "retry-after": "30" })
    const delay = SessionRetry.delay(3, error)
    // Should be within ±10% of 30000ms
    expect(delay).toBeGreaterThanOrEqual(27000)
    expect(delay).toBeLessThanOrEqual(33000)
  })

  test("accepts http-date retry-after values (with jitter)", () => {
    const date = new Date(Date.now() + 20000).toUTCString()
    const error = apiError({ "retry-after": date })
    const d = SessionRetry.delay(1, error)
    // With 10% jitter on ~20000ms, plus small timing variance
    expect(d).toBeGreaterThanOrEqual(17500)
    expect(d).toBeLessThanOrEqual(22500)
  })

  test("ignores invalid retry hints (with jitter)", () => {
    const error = apiError({ "retry-after": "not-a-number" })
    const delay = SessionRetry.delay(1, error)
    // Should fall back to 2000ms base delay with jitter
    expect(delay).toBeGreaterThanOrEqual(1800)
    expect(delay).toBeLessThanOrEqual(2200)
  })

  test("ignores malformed date retry hints (with jitter)", () => {
    const error = apiError({ "retry-after": "Invalid Date String" })
    const delay = SessionRetry.delay(1, error)
    // Should fall back to 2000ms base delay with jitter
    expect(delay).toBeGreaterThanOrEqual(1800)
    expect(delay).toBeLessThanOrEqual(2200)
  })

  test("ignores past date retry hints (with jitter)", () => {
    const pastDate = new Date(Date.now() - 5000).toUTCString()
    const error = apiError({ "retry-after": pastDate })
    const delay = SessionRetry.delay(1, error)
    // Should fall back to 2000ms base delay with jitter
    expect(delay).toBeGreaterThanOrEqual(1800)
    expect(delay).toBeLessThanOrEqual(2200)
  })

  test("uses retry-after values even when exceeding 10 minutes with headers (with jitter)", () => {
    const error = apiError({ "retry-after": "50" })
    const delay1 = SessionRetry.delay(1, error)
    expect(delay1).toBeGreaterThanOrEqual(45000)
    expect(delay1).toBeLessThanOrEqual(55000)

    const longError = apiError({ "retry-after-ms": "700000" })
    const delay2 = SessionRetry.delay(1, longError)
    expect(delay2).toBeGreaterThanOrEqual(630000)
    expect(delay2).toBeLessThanOrEqual(770000)
  })

  test("detects 429 rate limit errors", () => {
    const rateLimitError = apiError({}, 429)
    expect(SessionRetry.isRateLimitError(rateLimitError)).toBe(true)

    const normalError = apiError({}, 500)
    expect(SessionRetry.isRateLimitError(normalError)).toBe(false)

    expect(SessionRetry.isRateLimitError(undefined)).toBe(false)
  })

  test("uses aggressive backoff for 429 errors without retry-after headers", () => {
    const rateLimitError = apiError({}, 429)

    // 429 errors should use attempt-based exponential backoff (not attempt-1)
    const delay1 = SessionRetry.delay(1, rateLimitError)
    const delay2 = SessionRetry.delay(2, rateLimitError)
    const delay3 = SessionRetry.delay(3, rateLimitError)

    // Expected: 2000 * 2^1 = 4000ms for attempt 1
    expect(delay1).toBeGreaterThanOrEqual(3600)
    expect(delay1).toBeLessThanOrEqual(4400)

    // Expected: 2000 * 2^2 = 8000ms for attempt 2
    expect(delay2).toBeGreaterThanOrEqual(7200)
    expect(delay2).toBeLessThanOrEqual(8800)

    // Expected: 2000 * 2^3 = 16000ms for attempt 3
    expect(delay3).toBeGreaterThanOrEqual(14400)
    expect(delay3).toBeLessThanOrEqual(17600)
  })

  test("respects retry-after headers even for 429 errors", () => {
    const rateLimitError = apiError({ "retry-after": "5" }, 429)
    const delay = SessionRetry.delay(3, rateLimitError)

    // Should use the 5 second retry-after header, not exponential backoff
    expect(delay).toBeGreaterThanOrEqual(4500)
    expect(delay).toBeLessThanOrEqual(5500)
  })
})
