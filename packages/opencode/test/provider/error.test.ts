import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
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

  test("classifies opaque opencode-go model-only rejection as context overflow", () => {
    const responseBody = '{"model":"deepseek-v4.1-flash"}'
    const parsed = ProviderError.parseAPICallError({
      providerID: ProviderV2.ID.make("opencode"),
      error: new APICallError({
        message: "Provider request failed with HTTP 400",
        url: "https://example.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        responseBody,
        isRetryable: false,
      }),
    })
    expect(parsed.type).toBe("context_overflow")
  })
})
