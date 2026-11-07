import { describe, expect, test } from "bun:test"
import {
  AuthenticationError,
  ContentPolicyError,
  InvalidProviderOutputError,
  InvalidRequestError,
  UnsupportedOperationError,
  AIError,
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
} from "@opencode/ai/effect"
import { RequestExecutor } from "@opencode/ai/route"
import { Permission } from "@opencode/core/permission"
import { ID } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Provider } from "@opencode/core/provider"
import { Tool } from "@opencode/schema/tool"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"

const llm = (reason: AIError["reason"]) => new AIError({ reason })

describe("toSessionError", () => {
  test("maps every AI error reason to the open wire type", () => {
    expect(toSessionError(llm(new RateLimitError({ message: "rate", retryAfterMs: 123 })))).toEqual({
      type: "provider.rate-limit",
      message: "rate",
      retryAfterMs: 123,
    })
    expect(toSessionError(llm(new AuthenticationError({ message: "auth" }))).type).toBe("provider.auth")
    expect(toSessionError(llm(new QuotaExceededError({ message: "quota", retryAfterMs: 456 })))).toEqual({
      type: "provider.quota",
      message: "quota",
      retryAfterMs: 456,
    })
    expect(toSessionError(llm(new ContentPolicyError({ message: "blocked" }))).type).toBe("provider.content-filter")
    expect(
      toSessionError(llm(new TransportError({ message: "transport", transport: "http", operation: "request" }))).type,
    ).toBe("provider.transport")
    expect(toSessionError(llm(new ProviderInternalError({ message: "internal", retryAfterMs: 789 })))).toEqual({
      type: "provider.internal",
      message: "internal",
      retryAfterMs: 789,
    })
    expect(toSessionError(llm(new InvalidProviderOutputError({ message: "output" }))).type).toBe(
      "provider.invalid-output",
    )
    expect(toSessionError(llm(new InvalidRequestError({ message: "request" }))).type).toBe("provider.invalid-request")
    expect(
      toSessionError(
        llm(
          new UnsupportedOperationError({
            message: "no compact endpoint",
            operation: "compact",
            provider: ProviderID.make("provider"),
            route: "route",
          }),
        ),
      ),
    ).toEqual({ type: "provider.unsupported-operation", message: "no compact endpoint" })
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
    expect(toSessionError(llm(new UnknownProviderError({ message: "unknown" }))).type).toBe("provider.unknown")
  })

  test("separates the free and Go usage limits from paid rate limits, credit limits, and other providers' 429s", () => {
    const fail = (url: string, body: unknown, headers?: Record<string, string>) =>
      RequestExecutor.httpFailure({
        message: "Rate limit exceeded. Please try again later.",
        url,
        status: 429,
        responseHeaders: headers,
        responseBody: JSON.stringify(body),
      })

    const freeBody = {
      type: "error",
      error: { type: "FreeUsageLimitError", message: "Rate limit exceeded. Please try again later." },
    }
    const free = fail("https://opencode.ai/inference/openai/v1/chat/completions", freeBody, { "retry-after": "3600" })
    expect(SessionRunnerRetry.isRetryable(free)).toBe(false)
    expect(toSessionError(free)).toEqual({
      type: "provider.free-limit",
      message: "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.",
      status: 429,
      response: { body: JSON.stringify(freeBody) },
      retryAfterMs: 3_600_000,
    })

    const paid = fail(
      "https://opencode.ai/inference/openai/v1/chat/completions",
      { error: { type: "server_error", message: "Upstream request failed: Rate limit exceeded." } },
      { "retry-after": "45" },
    )
    expect(SessionRunnerRetry.isRetryable(paid)).toBe(true)
    expect(toSessionError(paid)).toMatchObject({ type: "provider.rate-limit", retryAfterMs: 45_000 })

    const goBody = {
      type: "error",
      error: { type: "GoUsageLimitError", message: "Go usage limit exceeded" },
      metadata: { workspace: "wrk_go_limit", limitName: "5 hour" },
    }
    const go = fail("https://opencode.ai/inference/go/openai/v1/chat/completions", goBody, { "retry-after": "120" })
    expect(SessionRunnerRetry.isRetryable(go)).toBe(false)
    expect(toSessionError(go)).toEqual({
      type: "provider.go-limit",
      message:
        "OpenCode Go 5 hour usage limit reached. Switch to a free model, or turn on Extra Usage on the Go page in OpenCode Console to keep going.",
      status: 429,
      response: { body: JSON.stringify(goBody) },
      retryAfterMs: 120_000,
    })

    const credit = RequestExecutor.httpFailure({
      message: "Credit limit exceeded.",
      url: "https://opencode.ai/inference/openai/v1/chat/completions",
      status: 402,
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "CreditLimitExceeded", message: "Credit limit exceeded." },
      }),
    })
    expect(toSessionError(credit)).toMatchObject({ type: "provider.quota" })

    const other = fail(
      "https://api.openai.com/v1/chat/completions",
      { error: { type: "rate_limit_error", message: "Too many requests" } },
      { "retry-after": "10" },
    )
    expect(SessionRunnerRetry.isRetryable(other)).toBe(true)
    expect(toSessionError(other)).toMatchObject({ type: "provider.rate-limit", retryAfterMs: 10_000 })
  })

  test("tells a budget on the requested model from one pausing all model use", () => {
    const refuse = (body: unknown) =>
      RequestExecutor.httpFailure({
        message: "A budget policy for this model has been reached.",
        url: "https://opencode.ai/inference/openai/v1/chat/completions",
        status: 429,
        responseBody: JSON.stringify(body),
      })
    const modelBody = {
      type: "error",
      error: { type: "BudgetLimitError", message: "A budget policy for this model has been reached." },
      metadata: { coverage: "models", resetsAt: "2026-11-01T00:00:00.000Z" },
    }
    const model = refuse(modelBody)
    expect(SessionRunnerRetry.isRetryable(model)).toBe(false)
    expect(toSessionError(model)).toEqual({
      type: "provider.model-budget-limit",
      message: "You've reached the spend limit for this model. Switch models to keep going.",
      status: 429,
      response: { body: JSON.stringify(modelBody) },
    })

    // Google clients get Google's envelope, with the same metadata in its ErrorInfo.
    const all = refuse({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Policy budget exceeded",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "BudgetLimitError",
            domain: "opencode.ai",
            metadata: { coverage: "all", resetsAt: "2026-11-01T00:00:00.000Z" },
          },
        ],
      },
    })
    expect(SessionRunnerRetry.isRetryable(all)).toBe(false)
    expect(toSessionError(all)).toMatchObject({
      type: "provider.budget-limit",
      message: "Workspace usage limit reached. Model use is paused until the limit resets.",
    })
  })

  test("types the ChatGPT usage limit whichever way the failure arrives", () => {
    const body = JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "Limit" } })
    for (const reason of [
      new RateLimitError({ message: "Too many requests", body }),
      new UnknownProviderError({ message: "Request failed", body }),
    ])
      expect(toSessionError(llm(reason))).toEqual({
        type: "provider.chatgpt-limit",
        message: "ChatGPT usage limit reached. Check ChatGPT Settings → Usage for details.",
        response: { body },
      })
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

  test("preserves provider HTTP status without exposing runtime diagnostics", () => {
    const http = new HttpContext({
      url: "https://example.com",
      status: 413,
      headers: { "x-request-id": "request-1" },
    })
    expect(
      toSessionError(
        llm(
          new InvalidRequestError({
            message: "too large",
            classification: "context-overflow",
            parameter: "messages",
            body: '{"error":"context limit"}',
            http,
            cause: new Error("request failed"),
          }),
        ),
      ),
    ).toEqual({
      type: "provider.invalid-request",
      message: "too large",
      status: 413,
      response: { body: '{"error":"context limit"}' },
    })
    expect(
      toSessionError(
        llm(
          new ProviderInternalError({
            message: "bad gateway",
            http: new HttpContext({ url: "https://example.com", status: 502, headers: {} }),
          }),
        ),
      ),
    ).toEqual({
      type: "provider.internal",
      message: "bad gateway",
      status: 502,
    })
  })

  test("preserves provider response body without HTTP status", () => {
    expect(toSessionError(llm(new RateLimitError({ message: "Slow down", body: '{"error":"rate limit"}' })))).toEqual({
      type: "provider.rate-limit",
      message: "Slow down",
      response: { body: '{"error":"rate limit"}' },
    })
  })

  test("maps token-sharing failures while preserving HTTP and stream bodies", () => {
    const cases = [
      ["subscription_sharing_user_not_eligible", "token sharing isn't available for this account"],
      ["subscription_sharing_usage_limit_exceeded", "ChatGPT usage limit reached"],
      ["subscription_sharing_usage_unavailable", "Try again later"],
      ["subscription_sharing_unsupported_capability", "Remove the unsupported feature"],
      ["subscription_sharing_route_not_supported", "Check the configured endpoint"],
      ["subscription_sharing_invalid_user", "Reconnect to ChatGPT"],
      ["subscription_sharing_user_unavailable", "Try again later"],
      ["chatpass_v2_scope_not_authorized", "isn't authorized for this request"],
      ["chatpass_v2_invalid_authorization_context", "isn't authorized for this request"],
    ] as const
    for (const [code, guidance] of cases) {
      for (const body of [
        JSON.stringify({ error: { code, message: "Request failed" } }),
        JSON.stringify({ type: "response.failed", response: { error: { code, message: "Request failed" } } }),
      ]) {
        const error = toSessionError(llm(new UnknownProviderError({ message: "Request failed", body })))
        expect(error.message).toContain(guidance)
        expect(error.response).toEqual({ body })
      }
    }
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

  test("preserves provider configuration and initialization errors", () => {
    const configuration = new ModelResolver.ModelConfigurationError({
      providerID: Provider.ID.make("azure"),
      modelID: ID.make("gpt-5.4-nano"),
      package: "@opencode/ai/providers/azure/responses",
      detail: "Azure requires resourceName or baseURL",
    })
    expect(toSessionError(configuration)).toEqual({
      type: "provider.no-route",
      message: "Cannot initialize azure/gpt-5.4-nano: Azure requires resourceName or baseURL",
    })
    const initialization = new ModelResolver.ModelInitializationError({
      providerID: Provider.ID.make("custom"),
      modelID: ID.make("model"),
      package: "@opencode/ai/providers/custom",
      phase: "load",
      detail: "Provider package @opencode/ai/providers/custom is broken",
    })
    expect(toSessionError(initialization)).toEqual({
      type: "provider.no-route",
      message: "Cannot initialize custom/model: Provider package @opencode/ai/providers/custom is broken",
    })
  })

  test("retries rate limits, provider-internal, transport, and unrecognized failures", () => {
    const eligible = [
      llm(new RateLimitError({ message: "rate" })),
      llm(new ProviderInternalError({ message: "internal" })),
      llm(new TransportError({ message: "transport", transport: "http", operation: "request" })),
      llm(new UnknownProviderError({ message: "unknown" })),
    ]
    const ineligible = [
      llm(new AuthenticationError({ message: "auth" })),
      llm(new QuotaExceededError({ message: "quota" })),
      llm(new ContentPolicyError({ message: "blocked" })),
      llm(new InvalidProviderOutputError({ message: "output" })),
      llm(new InvalidRequestError({ message: "request" })),
      llm(new UnsupportedOperationError({ message: "unsupported", operation: "compact" })),
      llm(
        new NoRouteError({
          message: "failed",
          route: "route",
          provider: ProviderID.make("provider"),
          model: ModelID.make("model"),
        }),
      ),
    ]

    expect(eligible.map(SessionRunnerRetry.isRetryable)).toEqual([true, true, true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false, false, false, false, false, false])
  })

  test("retries accepted transport reads but not accepted writes or rejected requests", () => {
    const retryable = [
      llm(new TransportError({ message: "http transport", transport: "http", operation: "request" })),
      llm(
        new TransportError({
          message: "connect failed",
          transport: "websocket",
          operation: "request",
          delivery: "not-sent",
          phase: "connect",
        }),
      ),
      llm(
        new TransportError({
          message: "send uncertain",
          transport: "websocket",
          operation: "write",
          delivery: "ambiguous",
          phase: "send",
        }),
      ),
      llm(
        new TransportError({
          message: "response interrupted",
          transport: "websocket",
          operation: "read",
          delivery: "accepted",
          phase: "receive",
        }),
      ),
    ]
    const ineligible = [
      llm(
        new TransportError({
          message: "accepted write failed",
          transport: "websocket",
          operation: "write",
          delivery: "accepted",
          phase: "send",
        }),
      ),
      llm(
        new TransportError({
          message: "continuation rejected",
          transport: "websocket",
          operation: "read",
          delivery: "rejected",
          recovery: "retry-full",
          phase: "receive",
        }),
      ),
    ]

    expect(retryable.map(SessionRunnerRetry.isRetryable)).toEqual([true, true, true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false])
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
        llm(
          new ProviderInternalError({
            message: "do not retry",
            http: http({ "x-should-retry": "false" }),
          }),
        ),
      ),
    ).toBeFalse()
    expect(
      SessionRunnerRetry.isRetryable(
        llm(new InvalidRequestError({ message: "retry", http: http({ "x-should-retry": "true" }) })),
      ),
    ).toBeTrue()
  })
})
