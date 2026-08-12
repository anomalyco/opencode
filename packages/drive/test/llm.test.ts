import { describe, expect, test } from "vitest"
import { Schema } from "effect"
import { Llm } from "../src/index.js"

describe("Llm", () => {
  test("constructs serializable output values", () => {
    expect(Llm.text("hello", { delay: 0, chunkSize: 3 })).toEqual({
      type: "text",
      text: "hello",
      options: { delay: 0, chunkSize: 3 },
    })
    expect(Llm.reasoning("thinking")).toEqual({
      type: "reasoning",
      text: "thinking",
    })
    expect(Llm.pause(20)).toEqual({ type: "pause", milliseconds: 20 })
    expect(
      Llm.toolCall({
        index: 0,
        id: "call_1",
        name: "read",
        input: { path: "src/example.ts" },
      }),
    ).toEqual({
      type: "toolCall",
      index: 0,
      id: "call_1",
      name: "read",
      input: { path: "src/example.ts" },
    })
    expect(
      Llm.toolCall(
        {
          index: 1,
          id: "call_2",
          name: "patch",
          input: { patchText: "*** Begin Patch\n*** End Patch" },
        },
        { delay: 20, chunkSize: 10 },
      ),
    ).toEqual({
      type: "toolCall",
      index: 1,
      id: "call_2",
      name: "patch",
      input: { patchText: "*** Begin Patch\n*** End Patch" },
      options: { delay: 20, chunkSize: 10 },
    })
    expect(Llm.raw({ usage: { inputTokens: 10 } })).toEqual({
      type: "raw",
      chunk: { usage: { inputTokens: 10 } },
    })
    expect(Llm.finish("tool-calls")).toEqual({
      type: "finish",
      reason: "tool-calls",
    })
    expect(Llm.disconnect()).toEqual({ type: "disconnect" })
  })

  test("decodes raw schema-compatible outputs", () => {
    const decode = Schema.decodeUnknownSync(Llm.Output)

    expect(decode({ type: "text", text: "raw" })).toEqual({
      type: "text",
      text: "raw",
    })
    expect(
      decode({
        type: "toolCall",
        index: 0,
        id: "call_2",
        name: "write",
        input: { path: "notes.txt", contents: "hello" },
      }),
    ).toEqual({
      type: "toolCall",
      index: 0,
      id: "call_2",
      name: "write",
      input: { path: "notes.txt", contents: "hello" },
    })
  })

  test("rejects invalid output values", () => {
    const decode = Schema.decodeUnknownSync(Llm.Output)

    expect(() => Llm.pause(-1)).toThrow()
    expect(() => Llm.pause(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => Llm.text("hello", { delay: -1 })).toThrow()
    expect(() => Llm.text("hello", { chunkSize: 0 })).toThrow()
    expect(() => Llm.text("hello", { chunkSize: 1.5 })).toThrow()
    expect(() => Llm.toolCall({ index: -1, id: "call_3", name: "read", input: {} })).toThrow()
    expect(() => Llm.toolCall({ index: 1.5, id: "call_3", name: "read", input: {} })).toThrow()
    expect(() =>
      Llm.toolCall(
        { index: 0, id: "call_3", name: "read", input: {} },
        { chunkSize: 0 },
      ),
    ).toThrow()
    expect(() =>
      Llm.toolCall({
        index: Number.NaN,
        id: "call_3",
        name: "read",
        input: {},
      }),
    ).toThrow()
    expect(() =>
      Llm.toolCall({
        index: Number.POSITIVE_INFINITY,
        id: "call_3",
        name: "read",
        input: {},
      }),
    ).toThrow()
    expect(() => decode({ type: "finish", reason: "unknown" })).toThrow()
    expect(() =>
      decode({
        type: "toolCall",
        index: "0",
        id: "call_3",
        name: "read",
        input: {},
      }),
    ).toThrow()
  })
})
