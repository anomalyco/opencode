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

  test("classifies provider request payload and media caps as context overflow", () => {
    const messages = [
      // Azure OpenAI request payload byte cap, returned as a 400 (not a 413)
      "Request content length exceeded 32 MB limit.",
      '400 status code: {"error":{"message":"Request content length exceeded 32 MB limit.","type":"invalid_request_error","param":null,"code":null}}',
      // Azure OpenAI per-request image cap
      "Exceeded maximum number of images (50) allowed in the request.",
      // OpenRouter double-wraps the upstream provider body as an escaped string in metadata.raw
      '{"error":{"message":"Provider returned error","code":400,"metadata":{"raw":"{\\"error\\": {\\"message\\": \\"Request content length exceeded 32 MB limit.\\"}}","provider_name":"Azure"}}}',
      '{"error":{"message":"Provider returned error","code":400,"metadata":{"raw":"{\\"error\\": {\\"message\\": \\"Exceeded maximum number of images (50) allowed in the request.\\"}}","provider_name":"Azure"}}}',
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
})
