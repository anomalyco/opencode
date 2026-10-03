import { describe, expect, test } from "bun:test"
import { isContextOverflow } from "../src"

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

  test("classifies opencode-go gateway limit messages as context overflow", () => {
    const messages = [
      "Input exceeds maximum input length of 148000 tokens",
      "Prompt exceeds token limit: 150000 > 148000",
      "Input exceeds 148000 tokens",
      "invalid_request_error: prompt is too long: 210000 tokens",
      "Provider request failed with HTTP 400: Input exceeds maximum input length of 148000 tokens",
      "Provider request failed with HTTP 400 (no body)",
      "400 status code (no body)",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
  })

  test("does not classify generic invalid requests as context overflow", () => {
    const messages = [
      "invalid parameter",
      "Provider request failed with HTTP 400: invalid parameter",
      "request too large",
      "Provider request failed with HTTP 413: request too large",
    ]

    expect(messages.some(isContextOverflow)).toBe(false)
  })

  test("does not classify rate limits as context overflow", () => {
    const messages = [
      "Throttling error: Too many tokens, please wait before trying again.",
      "Rate limit exceeded, please retry after 30 seconds.",
      "Too many requests. Please slow down.",
    ]

    expect(messages.some(isContextOverflow)).toBe(false)
  })
})
