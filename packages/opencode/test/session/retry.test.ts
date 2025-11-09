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
    const delays = Array.from({ length: 7 }, (_, index) => SessionRetry.getRetryDelayInMs(error, index + 1))
    expect(delays).toStrictEqual([2000, 4000, 8000, 16000, 32000, 64000, 128000])
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
