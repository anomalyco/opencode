import { describe, expect, test } from "bun:test"
import { RequestError } from "@agentclientprotocol/sdk"
import * as ACPError from "../../src/acp/error"

describe("acp.error", () => {
  test("maps validation failures to invalid params", () => {
    const cases: ACPError.Error[] = [
      new ACPError.SessionNotFoundError({ sessionId: "ses_missing" }),
      new ACPError.InvalidConfigOptionError({ configId: "temperature" }),
      new ACPError.InvalidModelError({ providerId: "anthropic", modelId: "claude-missing" }),
      new ACPError.InvalidEffortError({ effort: "extreme" }),
      new ACPError.InvalidModeError({ mode: "turbo" }),
    ]

    expect(cases.map((error) => ACPError.toRequestError(error).code)).toEqual([-32602, -32602, -32602, -32602, -32602])
  })

  test("includes safe validation details", () => {
    expect(ACPError.toRequestError(new ACPError.SessionNotFoundError({ sessionId: "ses_123" }))).toMatchObject({
      code: -32602,
      data: { sessionId: "ses_123" },
    })
    expect(ACPError.toRequestError(new ACPError.InvalidModelError({ modelId: "gpt-missing" }))).toMatchObject({
      code: -32602,
      data: { modelId: "gpt-missing" },
    })
  })

  test("maps auth required to the SDK auth error", () => {
    const requestError = ACPError.toRequestError(new ACPError.AuthRequiredError({ providerId: "anthropic" }))

    expect(requestError).toBeInstanceOf(RequestError)
    expect(requestError.code).toBe(-32000)
    expect(requestError.message).toBe("Authentication required: provider authentication required")
    expect(requestError.data).toEqual({ providerId: "anthropic" })
  })

  test("maps unsupported operations to method not found", () => {
    const requestError = ACPError.toRequestError(new ACPError.UnsupportedOperationError({ method: "session/new" }))

    expect(requestError.code).toBe(-32601)
    expect(requestError.data).toEqual({ method: "session/new" })
  })

  test("maps service failures to safe internal errors", () => {
    const requestError = ACPError.toRequestError(
      new ACPError.ServiceFailureError({ service: "provider", safeMessage: "Provider request failed" }),
    )

    expect(requestError.code).toBe(-32603)
    expect(requestError.message).toBe("Internal error: Provider request failed")
    expect(requestError.data).toEqual({ service: "provider" })
  })

  test("wraps unknown defects without leaking raw details", () => {
    const requestError = ACPError.toRequestError(
      ACPError.fromUnknownDefect(new Error("stack has sk-ant-secret and oauth refresh token")),
    )
    const serialized = JSON.stringify(requestError.toErrorResponse())

    expect(requestError.code).toBe(-32603)
    expect(requestError.message).toBe("Internal error: Internal service failure")
    expect(serialized).not.toContain("sk-ant-secret")
    expect(serialized).not.toContain("oauth refresh token")
    expect(serialized).not.toContain("stack")
  })
})
