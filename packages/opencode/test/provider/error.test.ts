import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "../../src/provider/error"
import { ProviderID } from "../../src/provider/schema"

describe("provider.error", () => {
  test("clarifies Claude Code-only Anthropic credentials", () => {
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("anthropic"),
      error: new APICallError({
        message: "Unauthorized",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode: 401,
        responseHeaders: { "content-type": "application/json" },
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "authentication_error",
            message: "This credential is only authorized for use with Claude Code and cannot be used for other API requests.",
          },
        }),
        isRetryable: false,
      }),
    })

    expect(result.type).toBe("api_error")
    if (result.type !== "api_error") return
    expect(result.message).toContain("restricted to Claude Code")
    expect(result.message).toContain("standard Anthropic API key")
    expect(result.message).toContain("opencode auth login anthropic")
  })

  test("keeps generic Anthropic auth errors unchanged", () => {
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("anthropic"),
      error: new APICallError({
        message: "Unauthorized",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode: 401,
        responseHeaders: { "content-type": "application/json" },
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "authentication_error",
            message: "Invalid API key",
          },
        }),
        isRetryable: false,
      }),
    })

    expect(result.type).toBe("api_error")
    if (result.type !== "api_error") return
    expect(result.message).not.toContain("restricted to Claude Code")
    expect(result.message).not.toContain("standard Anthropic API key")
  })
})
