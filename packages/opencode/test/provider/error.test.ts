import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "@/provider/error"
import { SessionRetry } from "@/session/retry"
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

describe("provider API call errors", () => {
  test("rewrites FreeUsageLimitError message to Go upsell", () => {
    const responseBody = JSON.stringify({
      type: "error",
      error: { type: "FreeUsageLimitError", message: "Rate limit exceeded. Please try again later." },
    })
    const parsed = ProviderError.parseAPICallError({
      providerID: ProviderV2.ID.make("opencode"),
      error: new APICallError({
        message: "Rate limit exceeded. Please try again later.",
        url: "https://opencode.ai/zen/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "retry-after": "30000" },
        responseBody,
        isRetryable: true,
      }),
    })

    expect(parsed).toMatchObject({
      type: "api_error",
      message: SessionRetry.GO_UPSELL_MESSAGE,
      statusCode: 429,
      responseBody,
    })
  })
})
