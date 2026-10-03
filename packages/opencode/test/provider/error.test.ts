import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "@/provider/error"
import { ProviderV2 } from "@opencode-ai/core/provider"

describe("provider stream errors", () => {
  test("retries provider stream errors without a code", () => {
    const messages = [
      "The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing: https://docs.x.ai/developers/advanced-api-usage/priority-processing",
      "The model is temporarily unavailable.",
    ]

    for (const message of messages)
      expect(
        ProviderError.parseStreamError({
          type: "error",
          error: { message },
        }),
      ).toEqual({
        type: "api_error",
        message,
        isRetryable: true,
        responseBody: JSON.stringify({ type: "error", error: { message } }),
      })
  })
})

describe("provider API call errors (#50574)", () => {
  const providerID = ProviderV2.ID.make("opencode-go")

  test("classifies generic 400 with overflow details in responseBody as context overflow", () => {
    const error = new APICallError({
      message: "Provider request failed with HTTP 400",
      url: "https://example.com/v1/chat",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: {},
      responseBody: JSON.stringify({
        error: { message: "prompt is too long: 941114 tokens > 1000000 maximum", type: "invalid_request_error" },
      }),
      isRetryable: false,
    })
    const parsed = ProviderError.parseAPICallError({ providerID, error })
    expect(parsed.type).toBe("context_overflow")
  })

  test("keeps generic 400 without overflow details as api_error", () => {
    const error = new APICallError({
      message: "Provider request failed with HTTP 400",
      url: "https://example.com/v1/chat",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: {},
      responseBody: JSON.stringify({
        error: { message: "invalid parameter: temperature must be >= 0", type: "invalid_request_error" },
      }),
      isRetryable: false,
    })
    const parsed = ProviderError.parseAPICallError({ providerID, error })
    expect(parsed.type).toBe("api_error")
  })
})
