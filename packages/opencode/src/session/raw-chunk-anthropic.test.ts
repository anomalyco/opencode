import { describe, expect, test } from "bun:test"
import { parseAnthropicRawChunk } from "./raw-chunk-anthropic"

describe("parseAnthropicRawChunk", () => {
  test("valid message_start with all fields", () => {
    const result = parseAnthropicRawChunk({
      type: "message_start",
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 1,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 200,
        },
      },
    })
    expect(result).toEqual({
      kind: "message_start",
      input: 100,
      cacheRead: 5000,
      cacheWrite: 200,
    })
  })

  test("valid message_start with only input_tokens (no cache)", () => {
    const result = parseAnthropicRawChunk({
      type: "message_start",
      message: { usage: { input_tokens: 42 } },
    })
    expect(result).toEqual({
      kind: "message_start",
      input: 42,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  test("valid message_delta", () => {
    const result = parseAnthropicRawChunk({
      type: "message_delta",
      usage: { output_tokens: 350 },
    })
    expect(result).toEqual({ kind: "message_delta", output: 350 })
  })

  test("content_block_delta returns null", () => {
    expect(
      parseAnthropicRawChunk({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello" },
      }),
    ).toBeNull()
  })

  test("content_block_start returns null", () => {
    expect(
      parseAnthropicRawChunk({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
    ).toBeNull()
  })

  test("content_block_stop returns null", () => {
    expect(parseAnthropicRawChunk({ type: "content_block_stop", index: 0 })).toBeNull()
  })

  test("message_stop returns null", () => {
    expect(parseAnthropicRawChunk({ type: "message_stop" })).toBeNull()
  })

  test("null input returns null", () => {
    expect(parseAnthropicRawChunk(null)).toBeNull()
  })

  test("undefined input returns null", () => {
    expect(parseAnthropicRawChunk(undefined)).toBeNull()
  })

  test("{} input returns null", () => {
    expect(parseAnthropicRawChunk({})).toBeNull()
  })

  test("message_start missing usage returns null", () => {
    expect(parseAnthropicRawChunk({ type: "message_start" })).toBeNull()
  })

  test("message_start with null usage returns null", () => {
    expect(
      parseAnthropicRawChunk({ type: "message_start", message: { usage: null } }),
    ).toBeNull()
  })

  test("message_delta with non-number output_tokens returns null", () => {
    expect(
      parseAnthropicRawChunk({
        type: "message_delta",
        usage: { output_tokens: "not-a-number" },
      }),
    ).toBeNull()
  })

  test("message_start with non-number input_tokens returns null", () => {
    expect(
      parseAnthropicRawChunk({
        type: "message_start",
        message: { usage: { input_tokens: "bad" } },
      }),
    ).toBeNull()
  })

  test("string input returns null", () => {
    expect(parseAnthropicRawChunk("hello")).toBeNull()
  })

  test("number input returns null", () => {
    expect(parseAnthropicRawChunk(42)).toBeNull()
  })
})
