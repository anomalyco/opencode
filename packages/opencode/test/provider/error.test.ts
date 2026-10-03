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

  test("surfaces weekly usage limit stream errors as non-retryable quota", () => {
    const message =
      "Weekly usage limit reached. Resets in 1hr 13min. To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_123/go"
    const parsed = ProviderError.parseStreamError({
      type: "error",
      error: { message },
    })

    expect(parsed).toEqual({
      type: "api_error",
      message,
      isRetryable: false,
      responseBody: JSON.stringify({ type: "error", error: { message } }),
    })
  })

  test("surfaces weekly quota limit API errors with their message instead of a JSON dump", () => {
    const quota =
      "Weekly usage limit reached. Resets in 1hr 13min. To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_123/go"
    const error = new APICallError({
      message: "Too Many Requests",
      url: "https://opencode.ai/zen/go/v1/responses",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "GoUsageLimitError", message: quota },
      }),
      isRetryable: true,
    })

    const parsed = ProviderError.parseAPICallError({ providerID: "opencode" as never, error })
    expect(parsed.type).toBe("api_error")
    if (parsed.type !== "api_error") throw new Error("expected api_error")
    expect(parsed.isRetryable).toBe(false)
    expect(parsed.message).toContain(quota)
  })
})
