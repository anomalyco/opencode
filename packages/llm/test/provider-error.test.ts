import { describe, expect, test } from "bun:test"
import { InvalidRequestReason, LLMError, isContextOverflow, isStaleReasoning, isStaleReasoningFailure } from "../src"

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

  test("classifies stale encrypted reasoning errors", () => {
    const messages = [
      "Error from provider (Console): Upstream request failed: [invalid_request_error] reasoning `encrypted_content` was not issued to this caller",
      "Upstream request failed: [invalid_encrypted_content] The encrypted content could not be verified. Reason: Encrypted content could not be decrypted or parsed.",
      "Referenced reasoning item 'rs_123' was not found or has expired",
      "Item 'rs_0a1b' of type 'reasoning' was provided without its required following item.",
    ]

    expect(messages.every(isStaleReasoning)).toBe(true)
    expect(isStaleReasoning("prompt is too long")).toBe(false)
  })

  test("matches stale reasoning failures from classified and raw errors", () => {
    expect(
      isStaleReasoningFailure(
        new LLMError({
          module: "test",
          method: "stream",
          reason: new InvalidRequestReason({
            message: "bad request",
            classification: "stale-reasoning",
          }),
        }),
      ),
    ).toBe(true)
    expect(
      isStaleReasoningFailure(
        new Error(
          "Error from provider (Console): Upstream request failed: [invalid_request_error] reasoning `encrypted_content` was not issued to this caller",
        ),
      ),
    ).toBe(true)
    expect(isStaleReasoningFailure(new Error("prompt is too long"))).toBe(false)
  })
})
