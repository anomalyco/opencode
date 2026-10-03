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
})

describe("wrapped response stream errors", () => {
  test("preserves retryable local stream timeouts wrapped by the SDK", () => {
    const error = new APICallError({
      message: "Failed to process successful response",
      url: "https://example.test/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 200,
      isRetryable: false,
      cause: new ProviderError.ResponseStreamError("SSE read timed out"),
    })
    expect(ProviderError.parseAPICallError({ providerID: ProviderV2.ID.make("test"), error })).toMatchObject({
      type: "api_error",
      message: "SSE read timed out",
      isRetryable: true,
      metadata: { code: "ProviderResponseStreamError" },
    })
  })
  test("does not make unrelated response parsing failures retryable", () => {
    const error = new APICallError({
      message: "Failed to process successful response",
      url: "https://example.test/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 200,
      isRetryable: false,
      cause: new Error("invalid payload"),
    })
    expect(ProviderError.parseAPICallError({ providerID: ProviderV2.ID.make("test"), error })).toMatchObject({
      type: "api_error",
      message: "Failed to process successful response",
      isRetryable: false,
    })
  })
})
