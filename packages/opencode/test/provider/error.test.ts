import { expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderError } from "@/provider/error"

test("parseAPICallError extracts OpenAI-shaped error.message", () => {
  const error = new APICallError({
    message: "Too Many Requests",
    statusCode: 429,
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    responseBody: JSON.stringify({
      error: {
        message: "Rate limit exceeded",
        type: "rate_limit_error",
      },
    }),
    isRetryable: true,
  })

  const parsed = ProviderError.parseAPICallError({
    providerID: ProviderV2.ID.make("openai"),
    error,
  })

  expect(parsed.type).toBe("api_error")
  expect(parsed.message).toBe("Too Many Requests: Rate limit exceeded")
})

test("parseAPICallError still extracts string body.error", () => {
  const error = new APICallError({
    message: "Bad Request",
    statusCode: 400,
    url: "https://example.com/v1/chat",
    requestBodyValues: {},
    responseBody: JSON.stringify({
      error: "model not found",
    }),
    isRetryable: false,
  })

  const parsed = ProviderError.parseAPICallError({
    providerID: ProviderV2.ID.make("openai"),
    error,
  })

  expect(parsed.type).toBe("api_error")
  expect(parsed.message).toBe("Bad Request: model not found")
})
