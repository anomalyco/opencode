import { describe, expect, test } from "bun:test"
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
  HttpRequestDetails,
  HttpResponseDetails,
} from "@opencode-ai/ai"
import { Permission } from "@opencode-ai/core/permission"
import { ID } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Provider } from "@opencode-ai/core/provider"
import { Tool } from "@opencode-ai/schema/tool"
import { toSessionError } from "@opencode-ai/core/session/to-session-error"
import { SessionRunnerRetry } from "@opencode-ai/core/session/runner/retry"

const llm = (reason: AIError["reason"]) => new AIError({ module: "test", method: "stream", reason })

describe("toSessionError", () => {
  test("maps every AI error reason to the open wire type", () => {
    expect(toSessionError(llm(new RateLimitReason({ message: "rate", retryAfterMs: 123 })))).toEqual({
      type: "provider.rate-limit",
      message: "rate",
    })
    expect(toSessionError(llm(new AuthenticationReason({ message: "auth", kind: "invalid" }))).type).toBe(
      "provider.auth",
    )
    expect(toSessionError(llm(new QuotaExceededReason({ message: "quota" }))).type).toBe("provider.quota")
    expect(toSessionError(llm(new ContentPolicyReason({ message: "blocked" }))).type).toBe("provider.content-filter")
    expect(
      toSessionError(llm(new TransportReason({ message: "transport", transport: "http", operation: "request" }))).type,
    ).toBe("provider.transport")
    expect(toSessionError(llm(new ProviderInternalReason({ message: "internal", status: 500 }))).type).toBe(
      "provider.internal",
    )
    expect(toSessionError(llm(new InvalidProviderOutputReason({ message: "output" }))).type).toBe(
      "provider.invalid-output",
    )
    expect(toSessionError(llm(new InvalidRequestReason({ message: "request" }))).type).toBe("provider.invalid-request")
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
    expect(toSessionError(llm(new UnknownProviderReason({ message: "unknown" }))).type).toBe("provider.unknown")
    expect(toSessionError(llm(new InvalidProviderOutputReason({ message: "malformed", raw: "not-json" })))).toEqual({
      type: "provider.invalid-output",
      message: "malformed",
      data: "not-json",
    })
  })

  test("preserves provider error data", () => {
    const data = {
      type: "error",
      sequence_number: 2,
      error: { type: "server_error", code: null, message: null },
    }
    expect(toSessionError(llm(new UnknownProviderReason({ message: "stream error", data })))).toEqual({
      type: "provider.unknown",
      message: "stream error",
      data,
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

  test("preserves provider HTTP status", () => {
    const http = new HttpContext({
      request: new HttpRequestDetails({ method: "POST", url: "https://example.com", headers: {} }),
      response: new HttpResponseDetails({ status: 413, headers: {} }),
    })
    expect(toSessionError(llm(new InvalidRequestReason({ message: "too large", http })))).toEqual({
      type: "provider.invalid-request",
      message: "too large",
      status: 413,
    })
    expect(toSessionError(llm(new ProviderInternalReason({ message: "bad gateway", status: 502 })))).toEqual({
      type: "provider.internal",
      message: "bad gateway",
      status: 502,
    })
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
      llm(new RateLimitReason({ message: "rate" })),
      llm(new ProviderInternalReason({ message: "internal", status: 500 })),
      llm(new TransportReason({ message: "transport", transport: "http", operation: "request" })),
    ]
    const ineligible = [
      llm(new AuthenticationReason({ message: "auth", kind: "invalid" })),
      llm(new QuotaExceededReason({ message: "quota" })),
      llm(new ContentPolicyReason({ message: "blocked" })),
      llm(new InvalidProviderOutputReason({ message: "output" })),
      llm(new InvalidRequestReason({ message: "request" })),
      llm(new NoRouteReason({ route: "route", provider: ProviderID.make("provider"), model: ModelID.make("model") })),
      llm(new UnknownProviderReason({ message: "unknown" })),
    ]

    expect(eligible.map(SessionRunnerRetry.isRetryable)).toEqual([true, true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false, false, false, false, false, false])
  })

  test("retries transport failures only when delivery is absent or not sent", () => {
    const retryable = [
      llm(new TransportReason({ message: "http transport", transport: "http", operation: "request" })),
      llm(
        new TransportReason({
          message: "connect failed",
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
          message: "send uncertain",
          transport: "websocket",
          operation: "write",
          delivery: "ambiguous",
          phase: "send",
        }),
      ),
      llm(
        new TransportReason({
          message: "response interrupted",
          transport: "websocket",
          operation: "read",
          delivery: "accepted",
          phase: "receive",
        }),
      ),
      llm(
        new TransportReason({
          message: "continuation rejected",
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
})
