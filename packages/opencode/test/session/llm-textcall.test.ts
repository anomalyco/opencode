import { describe, expect, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { LLMTextCall } from "../../src/session/llm/textcall"

const tools = new Set(["read", "lookup"])

async function run(parts: LanguageModelV3StreamPart[]) {
  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  }).pipeThrough(LLMTextCall.transform(tools))
  const out: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const next = await reader.read()
    if (next.done) return out
    out.push(next.value)
  }
}

const text = (id: string, chunks: string[]): LanguageModelV3StreamPart[] => [
  { type: "text-start", id },
  ...chunks.map((delta): LanguageModelV3StreamPart => ({ type: "text-delta", id, delta })),
  { type: "text-end", id },
]

describe("session.llm.textcall parse", () => {
  test("lifts a <tool_call> XML block", () => {
    expect(LLMTextCall.parse('<tool_call>{"name": "read", "arguments": {"filePath": "a.txt"}}</tool_call>', tools)).toEqual([
      { toolName: "read", input: '{"filePath":"a.txt"}' },
    ])
  })

  test("lifts multiple sequential <tool_call> blocks", () => {
    const calls = LLMTextCall.parse(
      '<tool_call>{"name": "read", "arguments": {"filePath": "a"}}</tool_call>\n<tool_call>{"name": "lookup", "arguments": {"query": "b"}}</tool_call>',
      tools,
    )
    expect(calls).toEqual([
      { toolName: "read", input: '{"filePath":"a"}' },
      { toolName: "lookup", input: '{"query":"b"}' },
    ])
  })

  test("lifts a fenced json block with tool/parameters aliases", () => {
    expect(LLMTextCall.parse('```json\n{"tool": "lookup", "parameters": {"query": "weather"}}\n```', tools)).toEqual([
      { toolName: "lookup", input: '{"query":"weather"}' },
    ])
  })

  test("lifts a bare JSON object with input alias and defaults missing args", () => {
    expect(LLMTextCall.parse('{"name": "lookup", "input": {"query": "x"}}', tools)).toEqual([
      { toolName: "lookup", input: '{"query":"x"}' },
    ])
    expect(LLMTextCall.parse('{"name": "lookup"}', tools)).toEqual([{ toolName: "lookup", input: "{}" }])
  })

  test("passes through unknown tool names, prose, and ambiguous shapes", () => {
    expect(LLMTextCall.parse('{"name": "unknown", "arguments": {}}', tools)).toBeUndefined()
    expect(LLMTextCall.parse("I will call the read tool now.", tools)).toBeUndefined()
    expect(LLMTextCall.parse('The call is <tool_call>{"name": "read"}</tool_call>', tools)).toBeUndefined()
    expect(LLMTextCall.parse('{"name": 42, "arguments": {}}', tools)).toBeUndefined()
    expect(LLMTextCall.parse('{"query": "no tool shape"}', tools)).toBeUndefined()
    expect(LLMTextCall.parse('```python\n{"name": "read"}\n```', tools)).toBeUndefined()
    expect(LLMTextCall.parse('```json\nnot json\n```', tools)).toBeUndefined()
  })
})

describe("session.llm.textcall transform", () => {
  test("converts a streamed tool_call block and suppresses the source text", async () => {
    const out = await run(text("t1", ["<tool_call>", '{"name": "read", "arg', 'uments": {"filePath": "a.txt"}}', "</tool_call>"]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: "tool-call", toolName: "read", input: '{"filePath":"a.txt"}' })
  })

  test("flushes prose as soon as the prefix diverges", async () => {
    const out = await run(text("t1", ["Let me ", "explain the plan."]))
    expect(out).toEqual([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Let me " },
      { type: "text-delta", id: "t1", delta: "explain the plan." },
      { type: "text-end", id: "t1" },
    ])
  })

  test("re-emits held text when the completed block is not a tool call", async () => {
    const out = await run(text("t1", ['{"just": ', '"data"}']))
    expect(out).toEqual([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: '{"just": "data"}' },
      { type: "text-end", id: "t1" },
    ])
  })

  test("prose mentioning a tool name passes through unchanged", async () => {
    const chunks = ["You should use the read tool ", "on a.txt."]
    const out = await run(text("t1", chunks))
    expect(out.filter((part) => part.type === "tool-call")).toHaveLength(0)
    const deltas = out.filter((part) => part.type === "text-delta")
    expect(deltas.map((part) => (part.type === "text-delta" ? part.delta : "")).join("")).toBe(chunks.join(""))
  })

  test("rewrites a stop finish to tool-calls when a call was lifted", async () => {
    const out = await run([
      ...text("t1", ['{"name": "lookup", "arguments": {"query": "w"}}']),
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {},
      } as LanguageModelV3StreamPart,
    ])
    const finish = out.find((part) => part.type === "finish")
    expect(finish).toMatchObject({ finishReason: { unified: "tool-calls" } })
  })

  test("keeps the finish reason when nothing was lifted", async () => {
    const out = await run([
      ...text("t1", ["hello"]),
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {},
      } as LanguageModelV3StreamPart,
    ])
    const finish = out.find((part) => part.type === "finish")
    expect(finish).toMatchObject({ finishReason: { unified: "stop" } })
  })

  test("never swallows held text when the stream ends without text-end", async () => {
    const out = await run([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "<tool_call>{trunc" },
    ])
    expect(out).toEqual([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "<tool_call>{trunc" },
    ])
  })
})
