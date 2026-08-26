import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { HttpClientError, HttpClientRequest } from "effect/unstable/http"
import {
  AuthenticationError,
  ContentPolicyError,
  InvalidProviderOutputError,
  InvalidRequestError,
  AIError,
  AIErrorReason,
  NoRouteError,
  ModelID,
  ProviderID,
  ProviderInternalError,
  QuotaExceededError,
  RateLimitError,
  TransportError,
  UnknownProviderError,
  ToolFailure,
  HttpContext,
} from "@opencode-ai/ai"
import { Permission } from "@opencode-ai/core/permission"
import { ID } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Provider } from "@opencode-ai/core/provider"
import { Tool } from "@opencode-ai/schema/tool"
import { toSessionError } from "@opencode-ai/core/session/to-session-error"
import { SessionRunnerRetry } from "@opencode-ai/core/session/runner/retry"
import { SessionError } from "@opencode-ai/schema/session-error"

const llm = (reason: AIError["reason"], message = reason.message, http?: HttpContext) =>
  new AIError({ reason: AIErrorReason.make({ ...reason, message, cause: reason.cause, http }) })

describe("toSessionError", () => {
  test("preserves tagged reason and native cause identity during generic enrichment", () => {
    const cause = new Error("native failure")
    const error = new AIError({ reason: new RateLimitError({ message: "rate limited", retryAfterMs: 123, cause }) })
    const http = new HttpContext({ url: "https://provider.test/responses", status: 429, headers: {} })
    const enriched = new AIError({
      reason: AIErrorReason.make({ ...error.reason, message: error.message, cause: error.reason.cause, http }),
    })
    expect(enriched.reason).toBeInstanceOf(RateLimitError)
    expect(enriched.reason).toBeInstanceOf(Error)
    expect(enriched.message).toBe("rate limited")
    expect(enriched.cause).toBe(enriched.reason)
    expect(enriched.reason.cause).toBe(cause)
    expect(enriched.reason.http).toBe(http)
    expect(toSessionError(enriched).reason).toEqual({ _tag: "RateLimit", retryAfterMs: 123 })
  })

  test("serializes native causes only once and omits diagnostics from reason JSON", () => {
    let calls = 0
    const cause = Object.assign(new Error("SDK failure"), {
      toJSON() {
        calls++
        return { requestBodyValues: { prompt: "private prompt" } }
      },
    })
    const error = toSessionError(
      new AIError({
        reason: new UnknownProviderError({ message: "Provider failed", body: "body", cause }),
      }),
    )
    expect(calls).toBe(1)
    expect(error).toEqual({
      type: "provider.unknown",
      message: "Provider failed",
      body: "body",
      reason: { _tag: "UnknownProvider" },
      cause: { name: "Error", message: "SDK failure", stack: expect.any(String) },
    })
  })

  test("maps every AI error reason to the open wire type", () => {
    expect(toSessionError(llm(new RateLimitError({ message: "rate", retryAfterMs: 123 }), "rate"))).toEqual({
      type: "provider.rate-limit",
      message: "rate",
      reason: { _tag: "RateLimit", retryAfterMs: 123 },
    })
    expect(toSessionError(llm(new AuthenticationError({ message: "failed", kind: "invalid" }))).type).toBe(
      "provider.auth",
    )
    expect(toSessionError(llm(new QuotaExceededError({ message: "failed" }))).type).toBe("provider.quota")
    expect(toSessionError(llm(new ContentPolicyError({ message: "failed" }))).type).toBe("provider.content-filter")
    expect(
      toSessionError(llm(new TransportError({ message: "failed", transport: "http", operation: "request" }))).type,
    ).toBe("provider.transport")
    expect(toSessionError(llm(new ProviderInternalError({ message: "failed" }))).type).toBe("provider.internal")
    expect(toSessionError(llm(new InvalidProviderOutputError({ message: "failed" }))).type).toBe(
      "provider.invalid-output",
    )
    expect(toSessionError(llm(new InvalidRequestError({ message: "failed" }))).type).toBe("provider.invalid-request")
    expect(
      toSessionError(
        llm(
          new NoRouteError({
            message: "failed",
            route: "route",
            provider: ProviderID.make("provider"),
            model: ModelID.make("model"),
          }),
        ),
      ).type,
    ).toBe("provider.no-route")
    expect(toSessionError(llm(new UnknownProviderError({ message: "failed" }))).type).toBe("provider.unknown")
  })

  test("preserves the permission rejection type without exposing internal fields", () => {
    const blocked = new Permission.BlockedError({ rules: [], permission: "external_directory", resources: [] })
    expect(toSessionError(blocked)).toEqual({
      type: "permission.rejected",
      message: "Permission denied: external_directory",
    })
    expect(toSessionError(new ToolFailure({ message: blocked.message, error: blocked }))).toEqual({
      type: "permission.rejected",
      message: "Permission denied: external_directory",
    })
    expect(toSessionError(new Tool.Error({ message: "failed" }))).toEqual({
      type: "tool.execution",
      message: "failed",
    })
  })

  test("preserves provider diagnostics through durable JSON encoding", () => {
    const http = new HttpContext({
      url: "https://example.com",
      status: 413,
      headers: { "x-request-id": "request-1" },
    })
    const inner = new Error("socket closed")
    const cause = Object.assign(new Error("request failed", { cause: inner }), {
      code: "ECONNRESET",
      requestBodyValues: { prompt: "private prompt" },
      requestHeaders: { authorization: "Bearer private-token" },
    })
    const error = toSessionError(
      new AIError({
        reason: new InvalidRequestError({
          message: "too large",
          classification: "context-overflow",
          parameter: "messages",
          body: '{"error":"context limit"}',
          http,
          cause,
        }),
      }),
    )
    const codec = Schema.fromJsonString(SessionError.Error)
    const encoded = Schema.encodeSync(codec)(error)
    expect(Schema.decodeUnknownSync(codec)(encoded)).toEqual({
      type: "provider.invalid-request",
      message: "too large",
      status: 413,
      body: '{"error":"context limit"}',
      http: { url: "https://example.com", status: 413, headers: { "x-request-id": "request-1" } },
      reason: { _tag: "InvalidRequest", classification: "context-overflow", parameter: "messages" },
      cause: {
        name: "Error",
        message: "request failed",
        stack: expect.any(String),
        code: "ECONNRESET",
        cause: { name: "Error", message: "socket closed", stack: expect.any(String) },
      },
    })
    expect(encoded).not.toContain("private prompt")
    expect(encoded).not.toContain("private-token")
  })

  test("reads historical session errors without diagnostics", () => {
    const decode = Schema.decodeUnknownSync(SessionError.Error)
    expect(decode({ type: "provider.internal", message: "bad gateway", status: 502 })).toEqual({
      type: "provider.internal",
      message: "bad gateway",
      status: 502,
    })
    expect(decode({ type: "unknown", message: "failed" })).toEqual({ type: "unknown", message: "failed" })
  })

  test("does not copy request credentials from Error toJSON methods", () => {
    const cause = new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({
        request: HttpClientRequest.post("https://provider.test/responses", {
          headers: { authorization: "Bearer private-token" },
        }),
        cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
      }),
    })
    const error = toSessionError(
      new AIError({
        reason: new TransportError({ message: "Connection failed", transport: "http", operation: "request", cause }),
      }),
    )
    expect(error.cause).toEqual({
      name: cause.name,
      message: cause.message,
      stack: expect.any(String),
      cause: {
        name: "Error",
        message: "connection refused",
        code: "ECONNREFUSED",
        stack: expect.any(String),
      },
    })
    expect(JSON.stringify(error)).not.toContain("private-token")
    expect(error.cause).not.toHaveProperty("reason")
  })

  test("serializes non-Error causes without losing JSON diagnostics", () => {
    const cause = { code: "invalid_response", detail: ["empty", 1] }
    expect(
      toSessionError(new AIError({ reason: new UnknownProviderError({ message: "failed", cause }) })).cause,
    ).toEqual(cause)
    expect(
      toSessionError(new AIError({ reason: new UnknownProviderError({ message: "failed", cause: 1n }) })).cause,
    ).toBe("1")
  })

  test("preserves SchemaError diagnostics despite its toJSON method", () => {
    const cause = Effect.runSync(Schema.decodeUnknownEffect(Schema.String)(undefined).pipe(Effect.flip))
    const error = toSessionError(
      new AIError({
        reason: new InvalidProviderOutputError({ message: "Invalid provider output", cause }),
      }),
    )
    expect(error.cause).toEqual({ name: cause.name, message: cause.message, stack: expect.any(String) })
  })

  test("preserves unresolved provider endpoint errors", () => {
    const error = new ModelResolver.UnresolvedProviderVariablesError({
      providerID: Provider.ID.make("cloudflare-workers-ai"),
      modelID: ID.make("model"),
      variables: ["CLOUDFLARE_ACCOUNT_ID"],
    })
    expect(toSessionError(error)).toEqual({
      type: "provider.no-route",
      message:
        "Cannot initialize cloudflare-workers-ai/model: CLOUDFLARE_ACCOUNT_ID is required to resolve the provider endpoint",
    })
  })

  test("retries only rate limits, provider-internal failures, and transport failures", () => {
    const eligible = [
      llm(new RateLimitError({ message: "failed" })),
      llm(new ProviderInternalError({ message: "failed" })),
      llm(new TransportError({ message: "failed", transport: "http", operation: "request" })),
    ]
    const ineligible = [
      llm(new AuthenticationError({ message: "failed", kind: "invalid" })),
      llm(new QuotaExceededError({ message: "failed" })),
      llm(new ContentPolicyError({ message: "failed" })),
      llm(new InvalidProviderOutputError({ message: "failed" })),
      llm(new InvalidRequestError({ message: "failed" })),
      llm(
        new NoRouteError({
          message: "failed",
          route: "route",
          provider: ProviderID.make("provider"),
          model: ModelID.make("model"),
        }),
      ),
      llm(new UnknownProviderError({ message: "failed" })),
    ]

    expect(eligible.map(SessionRunnerRetry.isRetryable)).toEqual([true, true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false, false, false, false, false, false])
  })

  test("retries transport failures only when delivery is absent or not sent", () => {
    const retryable = [
      llm(new TransportError({ message: "failed", transport: "http", operation: "request" })),
      llm(
        new TransportError({
          message: "failed",
          transport: "websocket",
          operation: "request",
          delivery: "not-sent",
          phase: "connect",
        }),
      ),
    ]
    const ineligible = [
      llm(
        new TransportError({
          message: "failed",
          transport: "websocket",
          operation: "write",
          delivery: "ambiguous",
          phase: "send",
        }),
      ),
      llm(
        new TransportError({
          message: "failed",
          transport: "websocket",
          operation: "read",
          delivery: "accepted",
          phase: "receive",
        }),
      ),
      llm(
        new TransportError({
          message: "failed",
          transport: "websocket",
          operation: "read",
          delivery: "rejected",
          recovery: "retry-full",
          phase: "receive",
        }),
      ),
    ]

    expect(retryable.map(SessionRunnerRetry.isRetryable)).toEqual([true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false, false])
  })

  test("honors provider retry header overrides", () => {
    const http = (headers: Record<string, string>) =>
      new HttpContext({
        url: "https://example.com",
        status: 500,
        headers,
      })

    expect(
      SessionRunnerRetry.isRetryable(
        llm(new ProviderInternalError({ message: "failed" }), "do not retry", http({ "x-should-retry": "false" })),
      ),
    ).toBeFalse()
    expect(
      SessionRunnerRetry.isRetryable(
        llm(new InvalidRequestError({ message: "failed" }), "retry", http({ "x-should-retry": "true" })),
      ),
    ).toBeTrue()
  })
})
