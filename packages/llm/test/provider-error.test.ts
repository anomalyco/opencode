import { describe, expect, test } from "bun:test"
import { isContextOverflow, isQuotaExceeded, isUpstreamTransient } from "../src"

describe("provider error classification", () => {
  test("classifies provider token limit messages as context overflow", () => {
    const messages = [
      "tokens in request more than max tokens allowed",
      '{"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
      "Requested token count exceeds the model's maximum context length of 131072 tokens.",
      "Input length (265330) exceeds model's maximum context length (262144).",
      "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
      "The input (516368 tokens) is longer than the model's context length (262144 tokens).",
      "Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
      "Too many tokens",
      "Token limit exceeded",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
  })

  test("does not classify rate limits as context overflow", () => {
    const messages = [
      "Throttling error: Too many tokens, please wait before trying again.",
      "Rate limit exceeded, please retry after 30 seconds.",
      "Too many requests. Please slow down.",
    ]

    expect(messages.some(isContextOverflow)).toBe(false)
  })

  test("classifies OpenCode Go usage limits as quota exceeded", () => {
    const messages = [
      "Weekly usage limit reached. Resets in 1hr 13min. To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_123/go",
      "Monthly usage limit reached. Resets in 2 days. To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_123/go",
      "5-hour usage limit reached. Resets in 30min. To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_123/go",
      'GoUsageLimitError: Weekly usage limit reached',
      '{"type":"error","error":{"type":"GoUsageLimitError","message":"Weekly usage limit reached"}}',
      "Subscription quota exceeded. Retry in 1hr.",
      "insufficient_quota: You exceeded your current quota",
    ]

    expect(messages.every(isQuotaExceeded)).toBe(true)
  })

  test("does not classify auth failures as quota exceeded", () => {
    const messages = [
      "Provider request failed with HTTP 401: Unauthorized",
      "Provider request failed with HTTP 403: Forbidden",
      "Invalid API key",
    ]

    expect(messages.some(isQuotaExceeded)).toBe(false)
  })

  test("classifies OpenCode Go upstream gateway failures as transient", () => {
    const messages = [
      "Upstream request failed: [server_error] Upstream response was not valid JSON",
      "Provider request failed with HTTP 403: Upstream request failed: [server_error] Upstream response was not valid JSON",
      "upstream_response_status_not_200",
      "server_error: Upstream model unavailable",
    ]

    expect(messages.every(isUpstreamTransient)).toBe(true)
  })

  test("does not classify auth failures as upstream transient", () => {
    const messages = [
      "Provider request failed with HTTP 403: Forbidden",
      "Unauthorized: invalid api key",
      "insufficient permissions for model",
    ]

    expect(messages.some(isUpstreamTransient)).toBe(false)
  })
})
