import { describe, expect, test } from "bun:test"
import type { NamedError } from "@opencode-ai/core/util/error"
import { APICallError } from "ai"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect, Layer, Schedule, Schema } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionRetry } from "../../src/session/retry"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderID } from "../../src/provider/schema"
import { ProviderError } from "../../src/provider/error"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const providerID = ProviderID.make("test")
const retryProvider = "test"
const it = testEffect(Layer.mergeAll(SessionStatus.defaultLayer, CrossSpawnSpawner.defaultLayer))

function apiError(headers?: Record<string, string>): MessageV2.APIError {
  return Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
    new MessageV2.APIError({
      message: "boom",
      isRetryable: true,
      responseHeaders: headers,
    }).toObject(),
  )
}

function wrap(message: unknown): ReturnType<NamedError["toObject"]> {
  return { name: "", data: { message } }
}

describe("session.retry.delay", () => {
  test("caps delay at 30 seconds when headers missing", () => {
    const error = apiError()
    const delays = Array.from({ length: 10 }, (_, index) => SessionRetry.delay(index + 1, error))
    expect(delays).toStrictEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000])
  })

  test("prefers retry-after-ms when shorter than exponential", () => {
    const error = apiError({ "retry-after-ms": "1500" })
    expect(SessionRetry.delay(4, error)).toBe(1500)
  })

  test("uses retry-after seconds when reasonable", () => {
    const error = apiError({ "retry-after": "30" })
    expect(SessionRetry.delay(3, error)).toBe(30000)
  })

  test("accepts http-date retry-after values", () => {
    const date = new Date(Date.now() + 20000).toUTCString()
    const error = apiError({ "retry-after": date })
    const d = SessionRetry.delay(1, error)
    expect(d).toBeGreaterThanOrEqual(19000)
    expect(d).toBeLessThanOrEqual(20000)
  })

  test("ignores invalid retry hints", () => {
    const error = apiError({ "retry-after": "not-a-number" })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("ignores malformed date retry hints", () => {
    const error = apiError({ "retry-after": "Invalid Date String" })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("ignores past date retry hints", () => {
    const pastDate = new Date(Date.now() - 5000).toUTCString()
    const error = apiError({ "retry-after": pastDate })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("uses retry-after values even when exceeding 10 minutes with headers", () => {
    const error = apiError({ "retry-after": "50" })
    expect(SessionRetry.delay(1, error)).toBe(50000)

    const longError = apiError({ "retry-after-ms": "700000" })
    expect(SessionRetry.delay(1, longError)).toBe(700000)
  })

  test("caps oversized header delays to the runtime timer limit", () => {
    const error = apiError({ "retry-after-ms": "999999999999" })
    expect(SessionRetry.delay(1, error)).toBe(SessionRetry.RETRY_MAX_DELAY)
  })

  it.live("policy updates retry status and increments attempts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessionID = SessionID.make("session-retry-test")
        const error = apiError({ "retry-after-ms": "0" })
        const status = yield* SessionStatus.Service

        const step = yield* Schedule.toStepWithMetadata(
          SessionRetry.policy({
            provider: "test",
            parse: Schema.decodeUnknownSync(MessageV2.APIError.Schema),
            set: (info) =>
              status.set(sessionID, {
                type: "retry",
                attempt: info.attempt,
                message: info.message,
                next: info.next,
              }),
          }),
        )
        yield* step(error)
        yield* step(error)

        expect(yield* status.get(sessionID)).toMatchObject({
          type: "retry",
          attempt: 2,
          message: "boom",
        })
      }),
    ),
  )
})

describe("session.retry.retryable", () => {
  test("maps too_many_requests json messages", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { type: "too_many_requests" } }))
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Too Many Requests" })
  })

  test("maps overloaded provider codes", () => {
    const error = wrap(JSON.stringify({ code: "resource_exhausted" }))
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Provider is overloaded" })
  })

  test("does not retry unknown json messages", () => {
    const error = wrap(JSON.stringify({ error: { message: "no_kv_space" } }))
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("does not throw on numeric error codes", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { code: 123 } }))
    const result = SessionRetry.retryable(error, retryProvider)
    expect(result).toBeUndefined()
  })

  test("returns undefined for non-json message", () => {
    const error = wrap("not-json")
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("retries plain text rate limit errors from Alibaba", () => {
    const msg =
      "Upstream error from Alibaba: Request rate increased too quickly. To ensure system stability, please adjust your client logic to scale requests more smoothly over time."
    const error = wrap(msg)
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: msg })
  })

  test("retries plain text rate limit errors", () => {
    const msg = "Rate limit exceeded, please try again later"
    const error = wrap(msg)
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: msg })
  })

  test("retries too many requests in plain text", () => {
    const msg = "Too many requests, please slow down"
    const error = wrap(msg)
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: msg })
  })

  test("retries transport timeout errors", () => {
    const request = MessageV2.fromError(new ProviderError.HeaderTimeoutError(10000), { providerID })
    expect(MessageV2.APIError.isInstance(request)).toBe(true)
    expect(SessionRetry.retryable(request, retryProvider)).toEqual({
      message: "Provider response headers timed out after 10000ms",
    })
  })

  test("retries websocket stream transport errors", () => {
    const request = MessageV2.fromError(
      new ProviderError.ResponseStreamError("WebSocket closed before response.completed (code 1006: Connection ended)"),
      { providerID },
    )
    expect(MessageV2.APIError.isInstance(request)).toBe(true)
    expect(SessionRetry.retryable(request, retryProvider)).toEqual({
      message: "WebSocket closed before response.completed (code 1006: Connection ended)",
    })
  })

  test("does not retry context overflow errors", () => {
    const error = new MessageV2.ContextOverflowError({
      message: "Input exceeds context window of this model",
      responseBody: '{"error":{"code":"context_length_exceeded"}}',
    }).toObject()

    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("retries 500 errors even when isRetryable is false", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Internal server error",
        isRetryable: false,
        statusCode: 500,
        responseBody: '{"type":"api_error","message":"Internal server error"}',
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Internal server error" })
  })

  test("retries 502 bad gateway errors", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Bad gateway",
        isRetryable: false,
        statusCode: 502,
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Bad gateway" })
  })

  test("retries 503 service unavailable errors", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Service unavailable",
        isRetryable: false,
        statusCode: 503,
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Service unavailable" })
  })

  test("does not retry 4xx errors when isRetryable is false", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Bad request",
        isRetryable: false,
        statusCode: 400,
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("retries ZlibError decompression failures", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Response decompression failed",
        isRetryable: true,
        metadata: { code: "ZlibError" },
      }).toObject(),
    )

    const retryable = SessionRetry.retryable(error, retryProvider)
    expect(retryable).toBeDefined()
    expect(retryable).toEqual({ message: "Response decompression failed" })
  })

  test("maps free limits to Go upsell action", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Free usage exceeded",
        isRetryable: true,
        statusCode: 429,
        responseBody: JSON.stringify({
          type: "error",
          error: { type: "FreeUsageLimitError", message: "Free usage exceeded" },
        }),
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, "opencode")).toEqual({
      message: SessionRetry.GO_UPSELL_MESSAGE,
      action: {
        reason: "free_tier_limit",
        provider: "opencode",
        title: "Free limit reached",
        message: "Subscribe to OpenCode Go for reliable access to the best open-source models, starting at $5/month.",
        label: "subscribe",
        link: SessionRetry.GO_UPSELL_URL,
      },
    })
  })

  test("maps Go subscription limits to workspace PAYG upsell", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Subscription quota exceeded. You can continue using free models.",
        isRetryable: true,
        statusCode: 429,
        responseHeaders: {
          "retry-after": "19380",
        },
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "GoUsageLimitError",
            message: "Subscription quota exceeded. You can continue using free models.",
          },
          metadata: {
            workspace: "wrk_01K6XGM22R6FM8JVABE9XDQXGH",
            limitName: "5 hour",
          },
        }),
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, "opencode-go")).toEqual({
      message:
        "5 hour usage limit reached. It will reset in 5 hours 23 minutes. To continue using this model now, enable usage from your available balance - https://opencode.ai/workspace/wrk_01K6XGM22R6FM8JVABE9XDQXGH/go",
      action: {
        reason: "account_rate_limit",
        provider: "opencode-go",
        title: "Go limit reached",
        message:
          "5 hour usage limit reached. It will reset in 5 hours 23 minutes. To continue using this model now, enable usage from your available balance",
        label: "open settings",
        link: "https://opencode.ai/workspace/wrk_01K6XGM22R6FM8JVABE9XDQXGH/go",
      },
    })
  })

  test("maps Go subscription limits without limit metadata", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Subscription quota exceeded. You can continue using free models.",
        isRetryable: true,
        statusCode: 429,
        responseHeaders: {
          "retry-after": "900",
        },
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "GoUsageLimitError",
            message: "Subscription quota exceeded. You can continue using free models.",
          },
          metadata: {
            workspace: "wrk_01K6XGM22R6FM8JVABE9XDQXGH",
          },
        }),
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, "opencode-go")?.action?.message).toBe(
      "Usage limit reached. It will reset in 15 minutes. To continue using this model now, enable usage from your available balance",
    )
  })

  test("retries ECONNRESET network errors", () => {
    const error = wrap("read ECONNRESET")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "read ECONNRESET" })
  })

  test("retries ECONNREFUSED network errors", () => {
    const error = wrap("connect ECONNREFUSED 127.0.0.1:3000")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "connect ECONNREFUSED 127.0.0.1:3000" })
  })

  test("retries ETIMEDOUT network errors", () => {
    const error = wrap("connect ETIMEDOUT 10.0.0.1:443")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "connect ETIMEDOUT 10.0.0.1:443" })
  })

  test("retries fetch failed network errors", () => {
    const error = wrap("fetch failed")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "fetch failed" })
  })

  test("retries Failed to fetch network errors", () => {
    const error = wrap("Failed to fetch")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Failed to fetch" })
  })

  test("retries socket hang up network errors", () => {
    const error = wrap("socket hang up")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "socket hang up" })
  })

  test("retries network error messages", () => {
    const error = wrap("Network Error")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Network Error" })
  })

  test("retries connection reset network errors", () => {
    const error = wrap("connection reset by peer")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "connection reset by peer" })
  })

  test("retries SSE chunk read timeout errors", () => {
    // Simulates the Mac-sleep bug: the provider stream stalls, the per-chunk
    // watchdog (wrapSSE in provider.ts) aborts with "SSE read timed out".
    // That error MUST be retryable, otherwise the session hangs on busy forever.
    const error = wrap("SSE read timed out")
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "SSE read timed out" })
  })

  test("does not retry user-initiated aborts", () => {
    // Boundary guard: pressing ESC aborts with a DOMException("Aborted").
    // The SSE-timeout fix must NOT make generic aborts retryable.
    const error = wrap("Aborted")
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("does not retry 4xx errors with timeout in message", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Request timeout waiting for response",
        isRetryable: false,
        statusCode: 400,
      }).toObject(),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("retries server_error nested error envelopes", () => {
    const error = wrap(
      JSON.stringify({
        type: "error",
        error: { type: "server_error", message: "An error occurred while processing your request." },
      }),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({
      message: "An error occurred while processing your request.",
    })
  })

  test("retries upstream_error nested error envelopes", () => {
    const error = wrap(
      JSON.stringify({
        type: "error",
        error: { type: "upstream_error", message: "Upstream service unavailable" },
      }),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({
      message: "Upstream service unavailable",
    })
  })

  test("retries stream_read_error nested error envelopes", () => {
    const error = wrap(
      JSON.stringify({
        type: "error",
        error: { type: "stream_read_error", message: "Failed to read stream" },
      }),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({
      message: "Failed to read stream",
    })
  })

  test("converts numeric code to string for pattern matching", () => {
    const error = wrap(JSON.stringify({ code: 502 }))
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  it.live("policy stops after RETRY_MAX_ATTEMPTS", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessionID = SessionID.make("session-retry-cap-test")
        const error = apiError({ "retry-after-ms": "0" })
        const status = yield* SessionStatus.Service

        const step = yield* Schedule.toStepWithMetadata(
          SessionRetry.policy({
            provider: "test",
            parse: Schema.decodeUnknownSync(MessageV2.APIError.Schema),
            set: (info) =>
              status.set(sessionID, {
                type: "retry",
                attempt: info.attempt,
                message: info.message,
                next: info.next,
              }),
          }),
        )

        yield* step(error)
        yield* step(error)
        yield* step(error)
        // attempt 4 should be capped by RETRY_MAX_ATTEMPTS
        yield* step(error).pipe(Effect.catch(() => Effect.void))

        expect(yield* status.get(sessionID)).toMatchObject({
          type: "retry",
          attempt: 3,
          message: "boom",
        })
      }),
    ),
  )
})

describe("session.retry_exhausted status", () => {
  it.live("accepts retry_exhausted status via status.set", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessionID = SessionID.make("session-retry-exhausted-set-test")
        const status = yield* SessionStatus.Service

        yield* status.set(sessionID, {
          type: "retry_exhausted",
          attempt: 3,
          message: "Network error: ECONNRESET",
          next: 0,
        })

        const current = yield* status.get(sessionID)
        expect(current).toMatchObject({
          type: "retry_exhausted",
          attempt: 3,
          message: "Network error: ECONNRESET",
          next: 0,
        })
      }),
    ),
  )

  it.live("policy tracks attempt count for retry exhaustion detection", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessionID = SessionID.make("session-retry-exhausted-track-test")
        const error = apiError({ "retry-after-ms": "0" })
        const status = yield* SessionStatus.Service
        let lastAttempt = 0

        const step = yield* Schedule.toStepWithMetadata(
          SessionRetry.policy({
            provider: "test",
            parse: Schema.decodeUnknownSync(MessageV2.APIError.Schema),
            set: (info) => {
              lastAttempt = info.attempt
              return status.set(sessionID, {
                type: "retry",
                attempt: info.attempt,
                message: info.message,
                next: info.next,
              })
            },
          }),
        )

        yield* step(error)
        yield* step(error)
        yield* step(error)
        // attempt 4 should be capped by RETRY_MAX_ATTEMPTS
        yield* step(error).pipe(Effect.catch(() => Effect.void))

        expect(lastAttempt).toBe(SessionRetry.RETRY_MAX_ATTEMPTS)
      }),
    ),
  )

  it.live("retry_exhausted status transitions to busy on new prompt", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessionID = SessionID.make("session-retry-exhausted-transition-test")
        const status = yield* SessionStatus.Service

        yield* status.set(sessionID, {
          type: "retry_exhausted",
          attempt: 3,
          message: "Network error",
          next: 0,
        })

        expect(yield* status.get(sessionID)).toMatchObject({ type: "retry_exhausted" })

        yield* status.set(sessionID, { type: "busy" })
        expect(yield* status.get(sessionID)).toMatchObject({ type: "busy" })
      }),
    ),
  )

  it.live("idle status returns to idle for non-retryable errors", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessionID = SessionID.make("session-retry-non-retryable-test")
        const status = yield* SessionStatus.Service

        // Set to busy first (simulating processor flow)
        yield* status.set(sessionID, { type: "busy" })

        // Non-retryable error should result in idle (existing behavior)
        yield* status.set(sessionID, { type: "idle" })
        expect(yield* status.get(sessionID)).toMatchObject({ type: "idle" })
      }),
    ),
  )
})

describe("session.message-v2.fromError", () => {
  test.concurrent(
    "converts ECONNRESET socket errors to retryable APIError",
    async () => {
      using server = Bun.serve({
        port: 0,
        idleTimeout: 8,
        async fetch(_req) {
          return new Response(
            new ReadableStream({
              async pull(controller) {
                controller.enqueue("Hello,")
                await sleep(10000)
                controller.enqueue(" World!")
                controller.close()
              },
            }),
            { headers: { "Content-Type": "text/plain" } },
          )
        },
      })

      const error = await fetch(new URL("/", server.url.origin))
        .then((res) => res.text())
        .catch((e) => e)

      const result = MessageV2.fromError(error, { providerID })

      expect(MessageV2.APIError.isInstance(result)).toBe(true)
      if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
      expect(result.data.isRetryable).toBe(true)
      expect(result.data.message).toBe("Connection reset by server")
      expect(result.data.metadata?.code).toBe("ECONNRESET")
      expect(result.data.metadata?.message).toInclude("socket connection")
    },
    15_000,
  )

  test("ECONNRESET socket error is retryable", () => {
    const error = Schema.decodeUnknownSync(MessageV2.APIError.Schema)(
      new MessageV2.APIError({
        message: "Connection reset by server",
        isRetryable: true,
        metadata: { code: "ECONNRESET", message: "The socket connection was closed unexpectedly" },
      }).toObject(),
    )

    const retryable = SessionRetry.retryable(error, retryProvider)
    expect(retryable).toBeDefined()
    expect(retryable).toEqual({ message: "Connection reset by server" })
  })

  test("marks OpenAI 404 status codes as retryable", () => {
    const error = new APICallError({
      message: "boom",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 404,
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"error":"boom"}',
      isRetryable: false,
    })
    const result = MessageV2.fromError(error, { providerID: ProviderID.make("openai") })
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(true)
  })

  test("converts OpenAI server_error stream chunks to retryable APIError", () => {
    const result = MessageV2.fromError(
      {
        message: JSON.stringify({
          type: "error",
          sequence_number: 2,
          error: {
            type: "server_error",
            code: "server_error",
            message: "An error occurred while processing your request.",
            param: null,
          },
        }),
      },
      { providerID: ProviderID.make("openai") },
    )

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(true)
    expect(SessionRetry.retryable(result, retryProvider)).toEqual({
      message: "An error occurred while processing your request.",
    })
  })
})
