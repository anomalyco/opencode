import { afterEach, beforeEach, describe, expect } from "bun:test"
import { AIError, isRetryable, ProviderInternalError, RateLimitError } from "@opencode/ai/effect"
import { ModelRetry } from "@opencode/core/model-retry"
import { Effect } from "effect"
import { it } from "./lib/effect"

// These tests assert the default budget, so no inherited deployment env may leak in.
const NAMES = ["OPENCODE_RETRY_MAX_RETRIES", "OPENCODE_RETRY_MAX_DELAY_MS"] as const

beforeEach(() => {
  for (const name of NAMES) delete process.env[name]
})
afterEach(() => {
  for (const name of NAMES) delete process.env[name]
})

const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })
const rateLimit = (retryAfterMs: number) =>
  new AIError({ reason: new RateLimitError({ message: "rate limited", retryAfterMs }) })

const input = (cause: AIError) => ({ cause, retry: isRetryable(cause) })

interface Decision {
  readonly attempt: number
  readonly delay: number
  readonly retry: boolean
}

// Decisions for `count` consecutive failures of the same cause within one policy.
const decisions = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const decide = yield* ModelRetry.policy
    const results: (Decision | undefined)[] = []
    for (let i = 0; i < count; i++) results.push(yield* decide(input(cause)))
    return results
  })

describe("ModelRetry.policy", () => {
  it.effect("defaults to ten attempts", () =>
    Effect.gen(function* () {
      const results = yield* decisions(internal, 12)
      expect(results.slice(0, 10).every((decision) => decision?.retry)).toBe(true)
      expect(results[10]).toBeUndefined()
    }),
  )

  it.effect("raises the attempt cap from OPENCODE_RETRY_MAX_RETRIES", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_RETRY_MAX_RETRIES = "3"
      const results = yield* decisions(internal, 5)
      expect(results.slice(0, 3).every((decision) => decision?.retry)).toBe(true)
      expect(results[3]).toBeUndefined()
    }),
  )

  it.effect("removes the attempt cap on infinite, in any case", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_RETRY_MAX_RETRIES = "INFINITE"
      const results = yield* decisions(internal, 30)
      expect(results.every((decision) => decision?.retry)).toBe(true)
    }),
  )

  it.effect("ignores values that are not positive integers", () =>
    Effect.gen(function* () {
      for (const value of ["0", "-5", "abc"]) {
        process.env.OPENCODE_RETRY_MAX_RETRIES = value
        const results = yield* decisions(internal, 12)
        expect(results[10], value).toBeUndefined()
      }
    }),
  )

  it.effect("raises the per-gap backoff cap from OPENCODE_RETRY_MAX_DELAY_MS", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_RETRY_MAX_DELAY_MS = "30000"
      const results = yield* decisions(internal, 8)
      const delays = results.map((decision) => decision?.delay ?? 0)
      // later gaps sit at the 30s cap (at least 24s after jitter); the default 10s cap tops out at 12s
      expect(Math.max(...delays)).toBeGreaterThan(12_000)
      expect(delays.every((delay) => delay <= 36_000)).toBe(true)
    }),
  )

  it.effect("bounds an honored retry-after by OPENCODE_RETRY_MAX_DELAY_MS", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_RETRY_MAX_DELAY_MS = "30000"
      const results = yield* decisions(rateLimit(600_000), 1)
      expect(results[0]?.delay).toBe(30_000)
    }),
  )

  it.effect("honors a retry-after within the default cap when the env is unset", () =>
    Effect.gen(function* () {
      const results = yield* decisions(rateLimit(60_000), 1)
      expect(results[0]?.delay).toBe(60_000)
    }),
  )
})
