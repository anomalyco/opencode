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

  test("classifies oversized openai-chat payloads as context overflow (#52174)", () => {
    const messages = [
      "Payload too large",
      "Request body too large",
      '{"statusCode":400,"errorCode":"inference_failed","message":"Payload too large"}',
      '{"statusCode":400,"errorCode":"inference_failed","message":"Request body too large"}',
      "Maximum request size exceeded",
      "Request exceeds size limit",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
  })

  test("does not classify generic inference failures as context overflow", () => {
    // `inference_failed` alone is generic (overload, invalid params, etc.)
    // and must not trigger context compaction.
    expect(isContextOverflow('{"statusCode":400,"errorCode":"inference_failed"}')).toBe(false)
    expect(isContextOverflow("inference failed")).toBe(false)
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
