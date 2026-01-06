import { test, expect } from "bun:test"
import { retry, isTransientError, isRateLimitError, isServerError, isRetryableError } from "@opencode-ai/util/retry"

// Test error detection functions
test("isTransientError: detects network errors", () => {
  expect(isTransientError(new Error("Failed to fetch"))).toBe(true)
  expect(isTransientError(new Error("Network request failed"))).toBe(true)
  expect(isTransientError(new Error("ECONNRESET"))).toBe(true)
  expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true)
  expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true)
  expect(isTransientError(new Error("Socket hang up"))).toBe(true)
  expect(isTransientError(new Error("load failed"))).toBe(true)

  // Non-transient errors
  expect(isTransientError(new Error("Not found"))).toBe(false)
  expect(isTransientError(new Error("Invalid input"))).toBe(false)
  expect(isTransientError(null)).toBe(false)
  expect(isTransientError(undefined)).toBe(false)
})

test("isRateLimitError: detects rate limit errors", () => {
  expect(isRateLimitError(new Error("Error 429: Too many requests"))).toBe(true)
  expect(isRateLimitError(new Error("Rate limit exceeded"))).toBe(true)
  expect(isRateLimitError(new Error("Too many requests"))).toBe(true)

  // Not rate limit errors
  expect(isRateLimitError(new Error("Not found"))).toBe(false)
  expect(isRateLimitError(new Error("500 Internal Server Error"))).toBe(false)
})

test("isServerError: detects server errors", () => {
  expect(isServerError(new Error("500 Internal Server Error"))).toBe(true)
  expect(isServerError(new Error("Error 502: Bad Gateway"))).toBe(true)
  expect(isServerError(new Error("503 Service Unavailable"))).toBe(true)
  expect(isServerError(new Error("504 Gateway Timeout"))).toBe(true)

  // Not server errors
  expect(isServerError(new Error("404 Not Found"))).toBe(false)
  expect(isServerError(new Error("400 Bad Request"))).toBe(false)
  expect(isServerError(new Error("Network error"))).toBe(false)
})

test("isRetryableError: combines all retryable error types", () => {
  // Transient errors
  expect(isRetryableError(new Error("Failed to fetch"))).toBe(true)
  expect(isRetryableError(new Error("ECONNRESET"))).toBe(true)

  // Rate limit errors
  expect(isRetryableError(new Error("429 Too many requests"))).toBe(true)

  // Server errors
  expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true)
  expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true)

  // Not retryable
  expect(isRetryableError(new Error("404 Not Found"))).toBe(false)
  expect(isRetryableError(new Error("Invalid input"))).toBe(false)
})

// Test retry function
test("retry: succeeds on first attempt", async () => {
  let attempts = 0
  const result = await retry(async () => {
    attempts++
    return "success"
  })

  expect(result).toBe("success")
  expect(attempts).toBe(1)
})

test("retry: retries on transient error and succeeds", async () => {
  let attempts = 0
  const result = await retry(
    async () => {
      attempts++
      if (attempts < 3) {
        throw new Error("Failed to fetch")
      }
      return "success"
    },
    { attempts: 5, delay: 10 },
  )

  expect(result).toBe("success")
  expect(attempts).toBe(3)
})

test("retry: throws after max attempts", async () => {
  let attempts = 0

  await expect(
    retry(
      async () => {
        attempts++
        throw new Error("Failed to fetch")
      },
      { attempts: 3, delay: 10 },
    ),
  ).rejects.toThrow("Failed to fetch")

  expect(attempts).toBe(3)
})

test("retry: does not retry non-transient errors by default", async () => {
  let attempts = 0

  await expect(
    retry(
      async () => {
        attempts++
        throw new Error("Invalid input")
      },
      { attempts: 3, delay: 10 },
    ),
  ).rejects.toThrow("Invalid input")

  expect(attempts).toBe(1) // No retries for non-transient error
})

test("retry: uses custom retryIf function", async () => {
  let attempts = 0

  const result = await retry(
    async () => {
      attempts++
      if (attempts < 2) {
        throw new Error("Custom retryable error")
      }
      return "success"
    },
    {
      attempts: 3,
      delay: 10,
      retryIf: (error) => error instanceof Error && error.message.includes("Custom"),
    },
  )

  expect(result).toBe("success")
  expect(attempts).toBe(2)
})

test("retry: uses isRetryableError for HTTP errors", async () => {
  let attempts = 0

  const result = await retry(
    async () => {
      attempts++
      if (attempts === 1) {
        throw new Error("503 Service Unavailable")
      }
      if (attempts === 2) {
        throw new Error("429 Too many requests")
      }
      return "success"
    },
    {
      attempts: 5,
      delay: 10,
      retryIf: isRetryableError,
    },
  )

  expect(result).toBe("success")
  expect(attempts).toBe(3)
})
