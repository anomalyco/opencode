import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Ref } from "effect"
import {
  AuthenticationReason,
  HttpContext,
  HttpRequestDetails,
  HttpResponseDetails,
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  RateLimitReason,
  TransportReason,
} from "@opencode-ai/llm"
import { ProviderRetry } from "@opencode-ai/core/session/runner/retry"
import { SessionTimeoutError } from "@opencode-ai/core/session/error"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { testEffect } from "../../lib/effect"

const SESSION_ID = ("ses_" + "0".repeat(64)) as SessionSchema.ID

const rateLimitError = (retryAfterMs?: number, http?: unknown) =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new RateLimitReason({ message: "rate limited", retryAfterMs, http: http as never }),
  })

const authError = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new AuthenticationReason({ message: "bad key", kind: "missing" }),
  })

const providerInternalError = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new ProviderInternalReason({ message: "server error", status: 503 }),
  })

const overflowError = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new InvalidRequestReason({ message: "prompt too long", classification: "context-overflow" }),
  })

const parse = (error: unknown) =>
  error instanceof LLMError ? { llmError: error, retryAfterMs: error.retryAfterMs } : undefined

const set = (retried: Ref.Ref<number>) => (_ctx: ProviderRetry.RetryContext) =>
  Ref.update(retried, (n) => n + 1)

const it = testEffect(Layer.empty)

describe("ProviderRetry", () => {
  describe("retryable", () => {
    test("rate-limit and provider-internal errors are retryable", () => {
      expect(ProviderRetry.retryable(rateLimitError())).toBe(true)
      expect(ProviderRetry.retryable(providerInternalError())).toBe(true)
    })

    test("authentication, transport, and overflow errors are not retryable", () => {
      expect(ProviderRetry.retryable(authError())).toBe(false)
      expect(ProviderRetry.retryable(new LLMError({ module: "test", method: "stream", reason: new TransportReason({ message: "lost" }) }))).toBe(false)
      expect(ProviderRetry.retryable(overflowError())).toBe(false)
    })

    test("non-LLMError values are not retryable", () => {
      expect(ProviderRetry.retryable("rate limit")).toBe(false)
      expect(ProviderRetry.retryable(undefined)).toBe(false)
      expect(ProviderRetry.retryable(new Error("boom"))).toBe(false)
    })
  })

  describe("retryDelay", () => {
    test("honours a Retry-After hint when present", () => {
      expect(ProviderRetry.retryDelay(1, 500, 0.5)).toBe(500)
      expect(ProviderRetry.retryDelay(1, 99_999, 0.5)).toBe(ProviderRetry.RETRY_MAX_DELAY)
    })

    test("falls back to capped exponential backoff without a hint (deterministic)", () => {
      expect(ProviderRetry.retryDelay(1, undefined, 0)).toBe(2000)
      expect(ProviderRetry.retryDelay(2, undefined, 0)).toBe(4000)
      expect(ProviderRetry.retryDelay(3, undefined, 0)).toBe(8000)
      expect(ProviderRetry.retryDelay(5, undefined, 0)).toBe(ProviderRetry.RETRY_MAX_DELAY_NO_HEADERS)
    })

    test("applies jitter within the expected band", () => {
      const withoutJitter = ProviderRetry.retryDelay(1, undefined, 0)
      const withJitter = ProviderRetry.retryDelay(1, undefined, 1)
      expect(withJitter).toBeGreaterThanOrEqual(withoutJitter)
      expect(withJitter).toBeLessThanOrEqual(Math.ceil(2000 + 2000 * ProviderRetry.RETRY_JITTER))
    })
  })

  describe("toRetryError", () => {
    test("maps a rate-limit LLMError without HTTP details", () => {
      const mapped = ProviderRetry.toRetryError(rateLimitError(120))
      expect(mapped.isRetryable).toBe(true)
      expect(mapped.statusCode).toBeUndefined()
      expect(mapped.responseHeaders).toBeUndefined()
      expect(mapped.responseBody).toBeUndefined()
    })

    test("maps HTTP details of a rate-limit LLMError into the RetryError", () => {
      const http = new HttpContext({
        request: new HttpRequestDetails({
          method: "POST",
          url: "https://api.test/v1/chat",
          headers: {},
        }),
        response: new HttpResponseDetails({
          status: 429,
          headers: { "retry-after-ms": "120" },
        }),
        body: "too many tokens",
      })
      const mapped = ProviderRetry.toRetryError(rateLimitError(undefined, http))
      expect(mapped.isRetryable).toBe(true)
      expect(mapped.statusCode).toBe(429)
      expect(mapped.responseHeaders).toEqual({ "retry-after-ms": "120" })
      expect(mapped.responseBody).toBe("too many tokens")
    })
  })

  // The retry schedule sleeps, so drive these under the live (real) clock with a
  // tiny Retry-After hint to keep them sub-second.
  describe("policy (integration)", () => {
    it.live("retries a transient failure once and then succeeds", () =>
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0)
        const retried = yield* Ref.make(0)
        const program = Effect.gen(function* () {
          const n = yield* Ref.updateAndGet(attempts, (n) => n + 1)
          if (n < 2) return yield* Effect.fail(rateLimitError(5))
          return "recovered"
        }).pipe(Effect.retry(ProviderRetry.policy({ parse, set: set(retried) })))
        const result = yield* program
        expect(result).toBe("recovered")
        expect(yield* Ref.get(attempts)).toBe(2)
        expect(yield* Ref.get(retried)).toBe(1)
      }),
    )

    it.live("does not retry a non-retryable failure", () =>
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0)
        const retried = yield* Ref.make(0)
        const program = Effect.gen(function* () {
          yield* Ref.update(attempts, (n) => n + 1)
          return yield* Effect.fail(authError())
        }).pipe(Effect.retry(ProviderRetry.policy({ parse, set: set(retried) })))
        const exit = yield* Effect.exit(program)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* Ref.get(attempts)).toBe(1)
        expect(yield* Ref.get(retried)).toBe(0)
      }),
    )

    it.live("exhausts retries up to the configured maximum", () =>
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0)
        const retried = yield* Ref.make(0)
        const program = Effect.gen(function* () {
          yield* Ref.update(attempts, (n) => n + 1)
          return yield* Effect.fail(rateLimitError(5))
        }).pipe(Effect.retry(ProviderRetry.policy({ parse, set: set(retried) })))
        const exit = yield* Effect.exit(program)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* Ref.get(attempts)).toBe(ProviderRetry.RETRY_MAX_RETRIES + 1)
        expect(yield* Ref.get(retried)).toBe(ProviderRetry.RETRY_MAX_RETRIES)
      }),
    )
  })
})

describe("DEFAULT_RECOVERY_LIMITS", () => {
  test("exposes the full Phase 11 policy limit set with retry wired", () => {
    expect(ProviderRetry.DEFAULT_RECOVERY_LIMITS.maxRetries).toBe(ProviderRetry.RETRY_MAX_RETRIES)
    expect(ProviderRetry.DEFAULT_RECOVERY_LIMITS.maxTokens).toBeGreaterThan(0)
    expect(ProviderRetry.DEFAULT_RECOVERY_LIMITS.maxExecutionTime).toBeGreaterThan(0)
    expect(ProviderRetry.DEFAULT_RECOVERY_LIMITS.maxToolFailures).toBeGreaterThan(0)
  })
})

describe("SessionTimeoutError", () => {
  test("carries the sessionID and elapsed budget", () => {
    const err = new SessionTimeoutError({
      sessionID: SESSION_ID,
      elapsed: ProviderRetry.DEFAULT_RECOVERY_LIMITS.maxExecutionTime,
    })
    expect(err._tag).toBe("Session.Timeout")
    expect(err.sessionID).toBe(SESSION_ID)
    expect(err.elapsed).toBe(ProviderRetry.DEFAULT_RECOVERY_LIMITS.maxExecutionTime)
    expect(err.message).toMatch(/max execution time/)
  })
})
