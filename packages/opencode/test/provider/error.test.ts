import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "@/provider/error"

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

describe("opencode-go gateway 400", () => {
  const providerID = "opencode-go" as any

  test("classifies gateway input-limit rejection as context overflow", () => {
    const error = new APICallError({
      message: "Bad Request",
      url: "https://opencode.ai/zen/go/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: {},
      responseBody: JSON.stringify({
        error: {
          type: "invalid_request_error",
          message: "Input length 150000 exceeds the maximum allowed input length of 148000 tokens",
        },
      }),
      isRetryable: false,
    })
    const parsed = ProviderError.parseAPICallError({ providerID, error })
    expect(parsed.type).toBe("context_overflow")
    expect(parsed.message).toContain("maximum allowed input length")
  })

  test("surfaces the provider body when the SDK message is already specific", () => {
    const error = new APICallError({
      message: "prompt is too long: 210000 tokens",
      url: "https://opencode.ai/zen/go/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: {},
      responseBody: JSON.stringify({
        error: {
          type: "invalid_request_error",
          message: "Input length 150000 exceeds the maximum allowed input length of 148000 tokens",
        },
      }),
      isRetryable: false,
    })
    const parsed = ProviderError.parseAPICallError({ providerID, error })
    expect(parsed.type).toBe("context_overflow")
    expect(parsed.message).toContain("maximum allowed input length")
  })

  test("does not classify generic invalid requests as context overflow", () => {
    const error = new APICallError({
      message: "Bad Request",
      url: "https://opencode.ai/zen/go/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: {},
      responseBody: "invalid parameter",
      isRetryable: false,
    })
    const parsed = ProviderError.parseAPICallError({ providerID, error })
    expect(parsed.type).toBe("api_error")
    if (parsed.type === "api_error") expect(parsed.message).toContain("invalid parameter")
  })
})
