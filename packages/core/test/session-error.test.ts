import { describe, expect, test } from "bun:test"
import {
  AuthenticationReason,
  ContentPolicyReason,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  LLMError,
  NoRouteReason,
  ModelID,
  ProviderID,
  ProviderInternalReason,
  QuotaExceededReason,
  RateLimitReason,
  TransportReason,
  UnknownProviderReason,
  ToolFailure,
} from "@opencode-ai/llm"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Tool } from "@opencode-ai/plugin/v2/effect/tool"
import { sanitizeErrorMessage, toSessionError } from "@opencode-ai/core/session/to-session-error"
import { SessionRunnerRetry } from "@opencode-ai/core/session/runner/retry"

const llm = (reason: LLMError["reason"]) => new LLMError({ module: "test", method: "stream", reason })

describe("sanitizeErrorMessage", () => {
  test("bounds html provider bodies for 503 retry notices", () => {
    const html = `<html>
<head><title>503 Service Temporarily Unavailable</title></head>
<body>
<center><h1>503 Service Temporarily Unavailable</h1></center>
<hr><center>nginx</center>
</body>
</html>`
    expect(sanitizeErrorMessage(`Provider request failed with HTTP 503: ${html}`)).toBe(
      "Provider temporarily unavailable (HTTP 503)",
    )
    expect(
      toSessionError(llm(new ProviderInternalReason({ message: `Provider request failed with HTTP 503: ${html}`, status: 503 }))),
    ).toEqual({
      type: "provider.internal",
      message: "Provider temporarily unavailable (HTTP 503)",
    })
  })

  test("leaves plain text messages unchanged", () => {
    expect(sanitizeErrorMessage("Service unavailable")).toBe("Service unavailable")
  })
})

describe("toSessionError", () => {
  test("maps every LLM reason to the open wire type", () => {
    expect(toSessionError(llm(new RateLimitReason({ message: "rate", retryAfterMs: 123 })))).toEqual({
      type: "provider.rate-limit",
      message: "rate",
    })
    expect(toSessionError(llm(new AuthenticationReason({ message: "auth", kind: "invalid" }))).type).toBe(
      "provider.auth",
    )
    expect(toSessionError(llm(new QuotaExceededReason({ message: "quota" }))).type).toBe("provider.quota")
    expect(toSessionError(llm(new ContentPolicyReason({ message: "blocked" }))).type).toBe("provider.content-filter")
    expect(toSessionError(llm(new TransportReason({ message: "transport" }))).type).toBe("provider.transport")
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
  })

  test("preserves the permission rejection type without exposing internal fields", () => {
    const blocked = new PermissionV2.BlockedError({ rules: [], permission: "external_directory", resources: [] })
    expect(toSessionError(blocked)).toEqual({
      type: "permission.rejected",
      message: "Permission denied: external_directory",
    })
    expect(toSessionError(new ToolFailure({ message: blocked.message, error: blocked }))).toEqual({
      type: "permission.rejected",
      message: "Permission denied: external_directory",
    })
    expect(toSessionError(new Tool.Failure({ message: "failed" }))).toEqual({
      type: "tool.execution",
      message: "failed",
    })
  })

  test("retries only rate limits, provider-internal failures, and transport failures", () => {
    const eligible = [
      llm(new RateLimitReason({ message: "rate" })),
      llm(new ProviderInternalReason({ message: "internal", status: 500 })),
      llm(new TransportReason({ message: "transport" })),
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
})
