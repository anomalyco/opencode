import { describe, expect, test } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import type { ModelMessage } from "ai"

describe("SessionProcessor.estimateInputChars", () => {
  test("returns 0 for empty messages", () => {
    expect(SessionProcessor.estimateInputChars([])).toBe(0)
  })

  test("counts chars from string content", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world!" },
    ]
    expect(SessionProcessor.estimateInputChars(messages)).toBe(11)
  })

  test("counts chars from array content with text parts", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: " world" },
        ],
      },
    ]
    expect(SessionProcessor.estimateInputChars(messages)).toBe(11)
  })

  test("ignores non-text parts in array content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image", image: new Uint8Array(), mimeType: "image/png" } as any,
        ],
      },
    ]
    expect(SessionProcessor.estimateInputChars(messages)).toBe(5)
  })

  test("handles mixed string and array content messages", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system prompt" },
      {
        role: "user",
        content: [{ type: "text", text: "user msg" }],
      },
      { role: "assistant", content: "reply" },
    ]
    // "system prompt" = 13, "user msg" = 8, "reply" = 5
    expect(SessionProcessor.estimateInputChars(messages)).toBe(26)
  })

  test("handles large input correctly", () => {
    const longText = "x".repeat(100_000)
    const messages: ModelMessage[] = [{ role: "user", content: longText }]
    expect(SessionProcessor.estimateInputChars(messages)).toBe(100_000)
  })
})

describe("SessionProcessor.computeTtftTimeout", () => {
  test("returns base when no messages", () => {
    expect(SessionProcessor.computeTtftTimeout(5000, [])).toBe(5000)
  })

  test("adds 0.5ms per char", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "x".repeat(2000) }]
    // 5000 + 2000 * 0.5 = 6000
    expect(SessionProcessor.computeTtftTimeout(5000, messages)).toBe(6000)
  })

  test("matches expected timeout table values", () => {
    const base = 5000

    // ~2K chars → 6s
    const msg2k: ModelMessage[] = [{ role: "user", content: "x".repeat(2000) }]
    expect(SessionProcessor.computeTtftTimeout(base, msg2k)).toBe(6000)

    // ~10K chars → 10s
    const msg10k: ModelMessage[] = [{ role: "user", content: "x".repeat(10_000) }]
    expect(SessionProcessor.computeTtftTimeout(base, msg10k)).toBe(10_000)

    // ~50K chars → 30s
    const msg50k: ModelMessage[] = [{ role: "user", content: "x".repeat(50_000) }]
    expect(SessionProcessor.computeTtftTimeout(base, msg50k)).toBe(30_000)

    // ~100K chars → 55s
    const msg100k: ModelMessage[] = [{ role: "user", content: "x".repeat(100_000) }]
    expect(SessionProcessor.computeTtftTimeout(base, msg100k)).toBe(55_000)

    // ~400K chars → 205s
    const msg400k: ModelMessage[] = [{ role: "user", content: "x".repeat(400_000) }]
    expect(SessionProcessor.computeTtftTimeout(base, msg400k)).toBe(205_000)
  })

  test("works with different base values", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "x".repeat(10_000) }]
    expect(SessionProcessor.computeTtftTimeout(3000, messages)).toBe(8000)
    expect(SessionProcessor.computeTtftTimeout(10_000, messages)).toBe(15_000)
  })

  test("accumulates chars across multiple messages", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "x".repeat(1000) },
      { role: "user", content: "x".repeat(3000) },
      { role: "assistant", content: "x".repeat(2000) },
    ]
    // 5000 + 6000 * 0.5 = 8000
    expect(SessionProcessor.computeTtftTimeout(5000, messages)).toBe(8000)
  })
})

describe("MessageV2.fromError with FirstTokenTimeoutError", () => {
  test("serializes FirstTokenTimeoutError as UnknownError", () => {
    const error = new Error("First token timeout after 6000ms for model test/model")
    error.name = "FirstTokenTimeoutError"
    const result = MessageV2.fromError(error, { providerID: "test" })

    expect(result.name).toBe("UnknownError")
    expect(result.data.message).toContain("First token timeout")
    expect(result.data.message).toContain("6000ms")
  })

  test("FirstTokenTimeoutError is not classified as AbortedError", () => {
    const error = new Error("First token timeout after 5000ms for model p/m")
    error.name = "FirstTokenTimeoutError"
    const result = MessageV2.fromError(error, { providerID: "test" })

    expect(MessageV2.AbortedError.isInstance(result)).toBe(false)
  })

  test("DOMException AbortError is classified as AbortedError", () => {
    const error = new DOMException("The operation was aborted", "AbortError")
    const result = MessageV2.fromError(error, { providerID: "test" })

    expect(MessageV2.AbortedError.isInstance(result)).toBe(true)
  })
})
