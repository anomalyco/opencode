import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { HttpClientError, HttpClientRequest } from "effect/unstable/http"
import {
  AuthenticationReason,
  ContentPolicyReason,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  AIError,
  NoRouteReason,
  ModelID,
  ProviderID,
  ProviderInternalReason,
  QuotaExceededReason,
  RateLimitReason,
  TransportReason,
  UnknownProviderReason,
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

const llm = (reason: AIError["reason"], message = "Provider failed", http?: HttpContext) =>
  new AIError({ message, reason, http })

describe("toSessionError", () => {
  test("maps every AI error reason to the open wire type", () => {
    expect(toSessionError(llm(new RateLimitReason({ retryAfterMs: 123 }), "rate"))).toEqual({
      type: "provider.rate-limit",
      message: "rate",
      reason: { _tag: "RateLimit", retryAfterMs: 123 },
    })
    expect(toSessionError(llm(new AuthenticationReason({ kind: "invalid" }))).type).toBe("provider.auth")
    expect(toSessionError(llm(new QuotaExceededReason({}))).type).toBe("provider.quota")
    expect(toSessionError(llm(new ContentPolicyReason({}))).type).toBe("provider.content-filter")
    expect(toSessionError(llm(new TransportReason({ transport: "http", operation: "request" }))).type).toBe(
      "provider.transport",
    )
    expect(toSessionError(llm(new ProviderInternalReason({}))).type).toBe("provider.internal")
    expect(toSessionError(llm(new InvalidProviderOutputReason({}))).type).toBe("provider.invalid-output")
    expect(toSessionError(llm(new InvalidRequestReason({}))).type).toBe("provider.invalid-request")
    expect(
      toSessionError(
        llm(
          new NoRouteReason({
            route: "route",
            provider: ProviderID.make("provider"),
            model: ModelID.make("model"),
          }),
        ),
      ).type,
    ).toBe("provider.no-route")
    expect(toSessionError(llm(new UnknownProviderReason({}))).type).toBe("provider.unknown")
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
        message: "too large",
        reason: new InvalidRequestReason({ classification: "context-overflow", parameter: "messages" }),
        body: '{"error":"context limit"}',
        http,
        cause,
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
        message: "Connection failed",
        reason: new TransportReason({ transport: "http", operation: "request" }),
        cause,
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
      toSessionError(new AIError({ message: "failed", reason: new UnknownProviderReason({}), cause })).cause,
    ).toEqual(cause)
    expect(
      toSessionError(new AIError({ message: "failed", reason: new UnknownProviderReason({}), cause: 1n })).cause,
    ).toBe("1")
  })

  test("preserves SchemaError diagnostics despite its toJSON method", () => {
    const cause = Effect.runSync(Schema.decodeUnknownEffect(Schema.String)(undefined).pipe(Effect.flip))
    const error = toSessionError(
      new AIError({
        message: "Invalid provider output",
        reason: new InvalidProviderOutputReason({}),
        cause,
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
      llm(new RateLimitReason({})),
      llm(new ProviderInternalReason({})),
      llm(new TransportReason({ transport: "http", operation: "request" })),
    ]
    const ineligible = [
      llm(new AuthenticationReason({ kind: "invalid" })),
      llm(new QuotaExceededReason({})),
      llm(new ContentPolicyReason({})),
      llm(new InvalidProviderOutputReason({})),
      llm(new InvalidRequestReason({})),
      llm(new NoRouteReason({ route: "route", provider: ProviderID.make("provider"), model: ModelID.make("model") })),
      llm(new UnknownProviderReason({})),
    ]

    expect(eligible.map(SessionRunnerRetry.isRetryable)).toEqual([true, true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false, false, false, false, false, false])
  })

  test("retries transport failures only when delivery is absent or not sent", () => {
    const retryable = [
      llm(new TransportReason({ transport: "http", operation: "request" })),
      llm(
        new TransportReason({
          transport: "websocket",
          operation: "request",
          delivery: "not-sent",
          phase: "connect",
        }),
      ),
    ]
    const ineligible = [
      llm(
        new TransportReason({
          transport: "websocket",
          operation: "write",
          delivery: "ambiguous",
          phase: "send",
        }),
      ),
      llm(
        new TransportReason({
          transport: "websocket",
          operation: "read",
          delivery: "accepted",
          phase: "receive",
        }),
      ),
      llm(
        new TransportReason({
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
        llm(new ProviderInternalReason({}), "do not retry", http({ "x-should-retry": "false" })),
      ),
    ).toBeFalse()
    expect(
      SessionRunnerRetry.isRetryable(llm(new InvalidRequestReason({}), "retry", http({ "x-should-retry": "true" }))),
    ).toBeTrue()
  })
})
