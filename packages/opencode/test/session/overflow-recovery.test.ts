import { describe, expect, test } from "bun:test"
import { SessionCompaction } from "../../src/session/compaction"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"
import type { ModelMessage } from "ai"

const TRUNCATED = "[Content truncated for compaction]"

function userMsg(text: string): ModelMessage {
  return { role: "user", content: [{ type: "text", text }] }
}

function assistantMsg(text: string): ModelMessage {
  return { role: "assistant", content: [{ type: "text", text }] }
}

function toolMsg(outputs: Array<{ type: string; value: unknown }>): ModelMessage {
  return {
    role: "tool",
    content: outputs.map((output, i) => ({
      type: "tool-result" as const,
      toolCallId: `call_${i}`,
      toolName: `tool_${i}`,
      output,
    })),
  } as ModelMessage
}

describe("session.compaction.truncateModelMessages", () => {
  test("passes through user and assistant messages unchanged", () => {
    const msgs: ModelMessage[] = [userMsg("hello"), assistantMsg("world")]
    const result = SessionCompaction.truncateModelMessages(msgs)
    expect(result).toEqual(msgs)
  })

  test("truncates long text tool output", () => {
    const long = "x".repeat(1000)
    const msg = toolMsg([{ type: "text", value: long }])
    const result = SessionCompaction.truncateModelMessages([msg])
    const output = (result[0] as any).content[0].output
    expect(output.type).toBe("text")
    expect(output.value).toBe(long.slice(0, 500) + "\n" + TRUNCATED)
  })

  test("preserves short text tool output", () => {
    const short = "x".repeat(100)
    const msg = toolMsg([{ type: "text", value: short }])
    const result = SessionCompaction.truncateModelMessages([msg])
    const output = (result[0] as any).content[0].output
    expect(output.type).toBe("text")
    expect(output.value).toBe(short)
  })

  test("replaces content-type tool output entirely", () => {
    const msg = toolMsg([{ type: "content", value: [{ type: "text", text: "big content" }] }])
    const result = SessionCompaction.truncateModelMessages([msg])
    const output = (result[0] as any).content[0].output
    expect(output.type).toBe("text")
    expect(output.value).toBe(TRUNCATED)
  })

  test("handles null/undefined output gracefully", () => {
    const msg = toolMsg([null as any])
    const result = SessionCompaction.truncateModelMessages([msg])
    const output = (result[0] as any).content[0].output
    expect(output.type).toBe("text")
    expect(output.value).toBe(TRUNCATED)
  })

  test("handles mixed message types in sequence", () => {
    const long = "y".repeat(800)
    const msgs: ModelMessage[] = [
      userMsg("question"),
      assistantMsg("thinking"),
      toolMsg([{ type: "text", value: long }]),
      assistantMsg("answer"),
    ]
    const result = SessionCompaction.truncateModelMessages(msgs)
    expect(result[0]).toEqual(msgs[0])
    expect(result[1]).toEqual(msgs[1])
    expect(result[3]).toEqual(msgs[3])
    const output = (result[2] as any).content[0].output
    expect(output.value).toBe(long.slice(0, 500) + "\n" + TRUNCATED)
  })

  test("truncates multiple tool results in single message", () => {
    const long1 = "a".repeat(600)
    const long2 = "b".repeat(700)
    const msg = toolMsg([
      { type: "text", value: long1 },
      { type: "text", value: long2 },
    ])
    const result = SessionCompaction.truncateModelMessages([msg])
    const c = (result[0] as any).content
    expect(c[0].output.value).toBe(long1.slice(0, 500) + "\n" + TRUNCATED)
    expect(c[1].output.value).toBe(long2.slice(0, 500) + "\n" + TRUNCATED)
  })

  test("truncates string value without type field when over 500 chars", () => {
    const long = "z".repeat(600)
    const msg = toolMsg([{ type: "unknown", value: long }])
    const result = SessionCompaction.truncateModelMessages([msg])
    const output = (result[0] as any).content[0].output
    expect(output.value).toBe(long.slice(0, 500) + "\n" + TRUNCATED)
  })
})

describe("overflow error detection chain", () => {
  test("ContextOverflowError is detected by isInstance", () => {
    const error = new MessageV2.ContextOverflowError({
      message: "Input exceeds context window",
      responseBody: '{"error":{"code":"context_length_exceeded"}}'
    }).toObject()
    expect(MessageV2.ContextOverflowError.isInstance(error)).toBe(true)
  })

  test("ContextOverflowError is not retryable", () => {
    const error = new MessageV2.ContextOverflowError({
      message: "Input exceeds context window",
    }).toObject()
    expect(SessionRetry.retryable(error as any)).toBeUndefined()
  })

  test("ContextOverflowError is not mistaken for APIError", () => {
    const error = new MessageV2.ContextOverflowError({
      message: "prompt is too long: 244186 tokens > 210000 maximum",
    }).toObject()
    expect(MessageV2.ContextOverflowError.isInstance(error)).toBe(true)
    expect(MessageV2.APIError.isInstance(error)).toBe(false)
  })

  test("APIError is not detected as ContextOverflowError", () => {
    const error = new MessageV2.APIError({
      message: "rate limited",
      isRetryable: true,
    }).toObject()
    expect(MessageV2.ContextOverflowError.isInstance(error)).toBe(false)
  })
})
