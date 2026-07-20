import { describe, expect, test } from "bun:test"
import { LLMEvent, isContextOverflow, isContextOverflowFinish } from "../src"

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

  test("classifies terminal usage overflow", () => {
    expect(
      isContextOverflowFinish(
        LLMEvent.finish({ reason: "stop", usage: { inputTokens: 200_001, outputTokens: 10 } }),
        200_000,
      ),
    ).toBe(true)
    expect(
      isContextOverflowFinish(
        LLMEvent.finish({ reason: "length", usage: { inputTokens: 198_000, outputTokens: 0 } }),
        200_000,
      ),
    ).toBe(true)
  })

  test("does not classify ordinary terminal usage as overflow", () => {
    expect(
      isContextOverflowFinish(
        LLMEvent.finish({ reason: "stop", usage: { inputTokens: 200_000, outputTokens: 10 } }),
        200_000,
      ),
    ).toBe(false)
    expect(
      isContextOverflowFinish(
        LLMEvent.finish({ reason: "length", usage: { inputTokens: 198_000, outputTokens: 1 } }),
        200_000,
      ),
    ).toBe(false)
    expect(isContextOverflowFinish(LLMEvent.finish({ reason: "length" }), 200_000)).toBe(false)
  })
})
