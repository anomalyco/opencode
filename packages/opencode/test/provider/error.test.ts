import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderError } from "@/provider/error"

describe("provider api call errors", () => {
  test("extracts nested error.message from an OpenAI-shaped body", () => {
    const error = new APICallError({
      message: "Too Many Requests",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { "content-type": "application/json" },
      responseBody: JSON.stringify({
        error: { message: "Rate limit reached for gpt-4 in org X", code: "rate_limit" },
      }),
      isRetryable: true,
    })

    const parsed = ProviderError.parseAPICallError({
      providerID: ProviderV2.ID.make("openai"),
      error,
    })

    expect(parsed.message).toBe("Too Many Requests: Rate limit reached for gpt-4 in org X")
  })

  test("still extracts a top-level string error field", () => {
    const error = new APICallError({
      message: "Bad Request",
      url: "https://example.com/v1/chat",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: { "content-type": "application/json" },
      responseBody: JSON.stringify({ error: "model not found" }),
      isRetryable: false,
    })

    const parsed = ProviderError.parseAPICallError({
      providerID: ProviderV2.ID.make("openai"),
      error,
    })

    expect(parsed.message).toBe("Bad Request: model not found")
  })
})

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
