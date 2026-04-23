import { test, expect } from "bun:test"
import { coerceNumericToolCallIds, transformSSEStream } from "../../src/util/coerce-tool-call-ids"

test("coerceNumericToolCallIds: coerces numeric id in tool_calls", () => {
  const obj: Record<string, unknown> = { tool_calls: [{ id: 123, function: { name: "read" } }] }
  coerceNumericToolCallIds(obj)
  expect((obj.tool_calls as Record<string, unknown>[])[0].id).toBe("123")
})

test("coerceNumericToolCallIds: coerces numeric id in delta.tool_calls", () => {
  const obj: Record<string, unknown> = { delta: { tool_calls: [{ id: 456, function: { name: "write" } }] } }
  coerceNumericToolCallIds(obj)
  const delta = obj.delta as Record<string, unknown>
  expect((delta.tool_calls as Record<string, unknown>[])[0].id).toBe("456")
})

test("coerceNumericToolCallIds: leaves string ids unchanged", () => {
  const obj: Record<string, unknown> = { tool_calls: [{ id: "call_abc123", function: { name: "read" } }] }
  coerceNumericToolCallIds(obj)
  expect((obj.tool_calls as Record<string, unknown>[])[0].id).toBe("call_abc123")
})

test("coerceNumericToolCallIds: handles nested objects", () => {
  const obj: Record<string, unknown> = { choices: [{ message: { tool_calls: [{ id: 789 }] } }] }
  coerceNumericToolCallIds(obj)
  const choice = (obj.choices as Record<string, unknown>[])[0] as Record<string, unknown>
  const message = choice.message as Record<string, unknown>
  expect((message.tool_calls as Record<string, unknown>[])[0].id).toBe("789")
})

test("coerceNumericToolCallIds: handles null and undefined inputs", () => {
  expect(() => coerceNumericToolCallIds(null)).not.toThrow()
  expect(() => coerceNumericToolCallIds(undefined)).not.toThrow()
})

test("coerceNumericToolCallIds: handles empty objects", () => {
  expect(() => coerceNumericToolCallIds({})).not.toThrow()
})

test("coerceNumericToolCallIds: handles arrays of tool calls", () => {
  const obj: Record<string, unknown> = { tool_calls: [{ id: 1 }, { id: 2 }, { id: 3 }] }
  coerceNumericToolCallIds(obj)
  const tcs = obj.tool_calls as Record<string, unknown>[]
  expect(tcs[0].id).toBe("1")
  expect(tcs[1].id).toBe("2")
  expect(tcs[2].id).toBe("3")
})

test("coerceNumericToolCallIds: mixed numeric and string ids", () => {
  const obj: Record<string, unknown> = { tool_calls: [{ id: 42 }, { id: "call_existing" }] }
  coerceNumericToolCallIds(obj)
  const tcs = obj.tool_calls as Record<string, unknown>[]
  expect(tcs[0].id).toBe("42")
  expect(tcs[1].id).toBe("call_existing")
})

test("coerceNumericToolCallIds: handles tool_calls with non-object entries", () => {
  const obj = { tool_calls: [null, undefined, "string", 42] }
  expect(() => coerceNumericToolCallIds(obj)).not.toThrow()
})

test("coerceNumericToolCallIds: handles primitive inputs", () => {
  expect(() => coerceNumericToolCallIds(42)).not.toThrow()
  expect(() => coerceNumericToolCallIds("string")).not.toThrow()
  expect(() => coerceNumericToolCallIds(true)).not.toThrow()
})

function toStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

test("transformSSEStream: coerces numeric tool call IDs in SSE data", async () => {
  const input = toStream(['data: {"tool_calls":[{"id":123}]}\n\n'])
  const output = await collect(transformSSEStream(input))
  const parsed = JSON.parse(output.trim().slice(6))
  expect(parsed.tool_calls[0].id).toBe("123")
})

test("transformSSEStream: passes through [DONE] unchanged", async () => {
  const input = toStream(["data: [DONE]\n\n"])
  const output = await collect(transformSSEStream(input))
  expect(output).toBe("data: [DONE]\n\n")
})

test("transformSSEStream: passes through invalid JSON unchanged", async () => {
  const input = toStream(["data: {not valid json}\n\n"])
  const output = await collect(transformSSEStream(input))
  expect(output).toBe("data: {not valid json}\n\n")
})

test("transformSSEStream: passes through non-data lines unchanged", async () => {
  const input = toStream(["event: ping\n\n"])
  const output = await collect(transformSSEStream(input))
  expect(output).toBe("event: ping\n\n")
})

test("transformSSEStream: handles multiple SSE events in one chunk", async () => {
  const input = toStream([
    'data: {"tool_calls":[{"id":1}]}\ndata: {"tool_calls":[{"id":2}]}\n\n',
  ])
  const output = await collect(transformSSEStream(input))
  const lines = output.split("\n").filter((l) => l.startsWith("data: "))
  const first = JSON.parse(lines[0].slice(6))
  const second = JSON.parse(lines[1].slice(6))
  expect(first.tool_calls[0].id).toBe("1")
  expect(second.tool_calls[0].id).toBe("2")
})

test("transformSSEStream: coerces numeric IDs in delta.tool_calls", async () => {
  const input = toStream(['data: {"delta":{"tool_calls":[{"id":999}]}}\n\n'])
  const output = await collect(transformSSEStream(input))
  const parsed = JSON.parse(output.trim().slice(6))
  expect(parsed.delta.tool_calls[0].id).toBe("999")
})
