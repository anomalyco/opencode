import { describe, expect, test } from "bun:test"
import { SessionRetry } from "../../src/session/retry"
import { MessageV2 } from "../../src/session/message-v2"

function apiError(headers?: Record<string, string>): MessageV2.APIError {
  return new MessageV2.APIError({
    message: "boom",
    isRetryable: true,
    responseHeaders: headers,
  }).toObject() as MessageV2.APIError
}

describe("session.retry.getRetryDelayInMs", () => {
  test("doubles delay on each attempt when headers missing", () => {
    const error = apiError()
    const delays = Array.from({ length: 10 }, (_, index) => SessionRetry.getRetryDelayInMs(error, index + 1))
    expect(delays).toStrictEqual([2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, undefined])
  })

  test("prefers retry-after-ms when shorter than exponential", () => {
    const error = apiError({ "retry-after-ms": "1500" })
    expect(SessionRetry.getRetryDelayInMs(error, 4)).toBe(1500)
  })

  test("uses retry-after seconds when reasonable", () => {
    const error = apiError({ "retry-after": "30" })
    expect(SessionRetry.getRetryDelayInMs(error, 3)).toBe(30000)
  })

  test("accepts http-date retry-after values", () => {
    const date = new Date(Date.now() + 20000).toUTCString()
    const error = apiError({ "retry-after": date })
    const delay = SessionRetry.getRetryDelayInMs(error, 1)
    expect(delay).toBeGreaterThanOrEqual(19000)
    expect(delay).toBeLessThanOrEqual(20000)
  })

  test("ignores invalid retry hints", () => {
    const error = apiError({ "retry-after": "not-a-number" })
    expect(SessionRetry.getRetryDelayInMs(error, 1)).toBe(2000)
  })

  test("ignores malformed date retry hints", () => {
    const error = apiError({ "retry-after": "Invalid Date String" })
    expect(SessionRetry.getRetryDelayInMs(error, 1)).toBe(2000)
  })

  test("ignores past date retry hints", () => {
    const pastDate = new Date(Date.now() - 5000).toUTCString()
    const error = apiError({ "retry-after": pastDate })
    expect(SessionRetry.getRetryDelayInMs(error, 1)).toBe(2000)
  })

  test("returns undefined when delay exceeds 10 minutes", () => {
    const error = apiError()
    expect(SessionRetry.getRetryDelayInMs(error, 10)).toBeUndefined()
  })

  test("returns undefined when retry-after exceeds 10 minutes", () => {
    const error = apiError({ "retry-after": "50" })
    expect(SessionRetry.getRetryDelayInMs(error, 1)).toBe(50000)

    const longError = apiError({ "retry-after-ms": "700000" })
    expect(SessionRetry.getRetryDelayInMs(longError, 1)).toBeUndefined()
  })
})

describe("session.retry.getBoundedDelay", () => {
  test("returns full delay when under time budget", () => {
    const error = apiError()
    const startTime = Date.now()
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 1,
      startTime,
    })
    expect(delay).toBe(2000)
  })

  test("returns remaining time when delay exceeds budget", () => {
    const error = apiError()
    const startTime = Date.now() - 598_000 // 598 seconds elapsed, 2 seconds remaining
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 1,
      startTime,
    })
    expect(delay).toBeGreaterThanOrEqual(1900)
    expect(delay).toBeLessThanOrEqual(2100)
  })

  test("returns undefined when time budget exhausted", () => {
    const error = apiError()
    const startTime = Date.now() - 600_000 // exactly 10 minutes elapsed
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 1,
      startTime,
    })
    expect(delay).toBeUndefined()
  })

  test("returns undefined when time budget exceeded", () => {
    const error = apiError()
    const startTime = Date.now() - 700_000 // 11+ minutes elapsed
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 1,
      startTime,
    })
    expect(delay).toBeUndefined()
  })

  test("respects custom maxDuration", () => {
    const error = apiError()
    const startTime = Date.now() - 58_000 // 58 seconds elapsed
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 1,
      startTime,
      maxDuration: 60_000, // 1 minute max
    })
    expect(delay).toBeGreaterThanOrEqual(1900)
    expect(delay).toBeLessThanOrEqual(2100)
  })

  test("caps exponential backoff to remaining time", () => {
    const error = apiError()
    const startTime = Date.now() - 595_000 // 595 seconds elapsed, 5 seconds remaining
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 5, // would normally be 32 seconds
      startTime,
    })
    expect(delay).toBeGreaterThanOrEqual(4900)
    expect(delay).toBeLessThanOrEqual(5100)
  })

  test("respects server retry-after within budget", () => {
    const error = apiError({ "retry-after": "30" })
    const startTime = Date.now() - 550_000 // 550 seconds elapsed, 50 seconds remaining
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 1,
      startTime,
    })
    expect(delay).toBe(30000)
  })

  test("caps server retry-after to remaining time", () => {
    const error = apiError({ "retry-after": "30" })
    const startTime = Date.now() - 590_000 // 590 seconds elapsed, 10 seconds remaining
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 1,
      startTime,
    })
    expect(delay).toBeGreaterThanOrEqual(9900)
    expect(delay).toBeLessThanOrEqual(10100)
  })

  test("returns undefined when getRetryDelayInMs returns undefined", () => {
    const error = apiError()
    const startTime = Date.now()
    const delay = SessionRetry.getBoundedDelay({
      error,
      attempt: 10, // exceeds RETRY_MAX_DELAY
      startTime,
    })
    expect(delay).toBeUndefined()
  })
})
