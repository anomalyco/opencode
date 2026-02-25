import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "../../src/provider/error"

function makeAPICallError(opts: {
  message: string
  statusCode?: number
  responseBody?: string
  isRetryable?: boolean
  responseHeaders?: Record<string, string>
}) {
  return new APICallError({
    message: opts.message,
    url: "https://bedrock.us-east-1.amazonaws.com",
    requestBodyValues: {},
    statusCode: opts.statusCode ?? 400,
    responseHeaders: opts.responseHeaders ?? {},
    responseBody: opts.responseBody,
    isRetryable: opts.isRetryable ?? false,
  })
}

describe("provider.error.parseAPICallError", () => {
  // Issue #2: Bedrock "undefined" message handling
  test("detects overflow when message is literal 'undefined' and responseBody has prompt-too-long", () => {
    const error = makeAPICallError({
      message: "undefined",
      statusCode: 400,
      responseBody: JSON.stringify({
        message: "prompt is too long: 208845 tokens > 200000 maximum",
      }),
    })
    const result = ProviderError.parseAPICallError({
      providerID: "amazon-bedrock",
      error,
    })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow when message is empty string and responseBody has prompt-too-long", () => {
    const error = makeAPICallError({
      message: "",
      statusCode: 400,
      responseBody: JSON.stringify({
        message: "prompt is too long: 208845 tokens > 200000 maximum",
      }),
    })
    const result = ProviderError.parseAPICallError({
      providerID: "amazon-bedrock",
      error,
    })
    expect(result.type).toBe("context_overflow")
  })

  test("does NOT treat literal 'undefined' as overflow when responseBody has no overflow pattern", () => {
    const error = makeAPICallError({
      message: "undefined",
      statusCode: 403,
      responseBody: JSON.stringify({ message: "Access denied" }),
    })
    const result = ProviderError.parseAPICallError({
      providerID: "amazon-bedrock",
      error,
    })
    expect(result.type).toBe("api_error")
  })

  test("falls back to statusCode text when message is 'undefined' and no responseBody", () => {
    const error = makeAPICallError({
      message: "undefined",
      statusCode: 429,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "amazon-bedrock",
      error,
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Too Many Requests")
    }
  })

  test("returns 'Unknown error' when message is 'undefined' and no responseBody or statusCode", () => {
    const error = new APICallError({
      message: "undefined",
      url: "https://test",
      requestBodyValues: {},
      responseHeaders: {},
      isRetryable: false,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "amazon-bedrock",
      error,
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Unknown error")
    }
  })

  // Overflow patterns across providers
  test("detects overflow for direct Anthropic provider with normal message", () => {
    const error = makeAPICallError({
      message: "prompt is too long: 208845 tokens > 200000 maximum",
      statusCode: 400,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "anthropic",
      error,
    })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow for Bedrock 'input is too long' pattern", () => {
    const error = makeAPICallError({
      message: "undefined",
      statusCode: 400,
      responseBody: "input is too long for requested model",
    })
    const result = ProviderError.parseAPICallError({
      providerID: "amazon-bedrock",
      error,
    })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow for OpenAI 'exceeds the context window' pattern", () => {
    const error = makeAPICallError({
      message: "This model's maximum context length exceeds the context window",
      statusCode: 400,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "openai",
      error,
    })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow for generic 'context_length_exceeded' pattern", () => {
    const error = makeAPICallError({
      message: "context_length_exceeded",
      statusCode: 400,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "openrouter",
      error,
    })
    expect(result.type).toBe("context_overflow")
  })

  // Non-overflow API errors
  test("returns api_error for rate limit errors", () => {
    const error = makeAPICallError({
      message: "Rate limit exceeded",
      statusCode: 429,
      isRetryable: true,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "amazon-bedrock",
      error,
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(true)
      expect(result.statusCode).toBe(429)
    }
  })

  test("returns api_error with isRetryable false for auth errors", () => {
    const error = makeAPICallError({
      message: "Invalid API key",
      statusCode: 401,
      isRetryable: false,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "anthropic",
      error,
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(false)
    }
  })

  test("includes url metadata when error has url", () => {
    const error = makeAPICallError({
      message: "Server error",
      statusCode: 500,
      isRetryable: true,
    })
    const result = ProviderError.parseAPICallError({
      providerID: "anthropic",
      error,
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.metadata).toBeDefined()
    }
  })
})

describe("provider.error.parseStreamError", () => {
  test("detects context_length_exceeded from stream error", () => {
    const result = ProviderError.parseStreamError({
      type: "error",
      error: { code: "context_length_exceeded" },
    })
    expect(result).toBeDefined()
    expect(result!.type).toBe("context_overflow")
  })

  test("detects insufficient_quota from stream error", () => {
    const result = ProviderError.parseStreamError({
      type: "error",
      error: { code: "insufficient_quota" },
    })
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.isRetryable).toBe(false)
    }
  })

  test("returns undefined for non-error stream events", () => {
    const result = ProviderError.parseStreamError({ type: "data", content: "hello" })
    expect(result).toBeUndefined()
  })

  test("returns undefined for non-object input", () => {
    expect(ProviderError.parseStreamError("string")).toBeUndefined()
    expect(ProviderError.parseStreamError(42)).toBeUndefined()
    expect(ProviderError.parseStreamError(null)).toBeUndefined()
  })

  test("parses JSON string input", () => {
    const result = ProviderError.parseStreamError(
      JSON.stringify({ type: "error", error: { code: "context_length_exceeded" } }),
    )
    expect(result).toBeDefined()
    expect(result!.type).toBe("context_overflow")
  })
})
