import { expect, test } from "bun:test"
import * as Convert from "@/server/routes/instance/httpapi/gateway/openai-convert"

async function* fromParts(parts: Array<Record<string, unknown>>) {
  for (const part of parts) yield part as never
}

async function collect(iter: AsyncIterable<string>) {
  const out: string[] = []
  for await (const chunk of iter) out.push(chunk)
  return out
}

function parseChunks(frames: string[]) {
  return frames
    .flatMap((f) => f.split("\n\n"))
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l.length > 0)
}

const meta: Convert.ChunkMeta = { id: "chatcmpl-test", created: 1, model: "anthropic/claude", includeUsage: false }

test("toModelMessages maps roles, tool_calls and tool results", () => {
  const messages = Convert.toModelMessages([
    { role: "system", content: "you are helpful" },
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"q":"paris"}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: "sunny" },
  ])

  expect(messages[0]).toEqual({ role: "system", content: "you are helpful" })
  expect(messages[1]).toEqual({ role: "user", content: "hello" })
  const assistant = messages[2] as { role: string; content: Array<Record<string, unknown>> }
  expect(assistant.role).toBe("assistant")
  expect(assistant.content[0]).toEqual({
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "get_weather",
    input: { q: "paris" },
  })
  const tool = messages[3] as { role: string; content: Array<Record<string, unknown>> }
  expect(tool.role).toBe("tool")
  expect(tool.content[0]).toEqual({
    type: "tool-result",
    toolCallId: "call_1",
    toolName: "get_weather",
    output: { type: "text", value: "sunny" },
  })
})

test("toModelMessages maps multimodal user content", () => {
  const [message] = Convert.toModelMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "what is this" },
        { type: "image_url", image_url: { url: "https://example.com/a.png" } },
      ],
    },
  ])
  expect(message).toEqual({
    role: "user",
    content: [
      { type: "text", text: "what is this" },
      { type: "image", image: "https://example.com/a.png" },
    ],
  })
})

test("toTools builds passthrough tools without execute", () => {
  const tools = Convert.toTools([
    { type: "function", function: { name: "ping", description: "p", parameters: { type: "object", properties: {} } } },
  ])
  expect(tools).toBeDefined()
  expect(Object.keys(tools!)).toEqual(["ping"])
  expect((tools!["ping"] as { execute?: unknown }).execute).toBeUndefined()
})

test("toToolChoice maps named function choice", () => {
  expect(Convert.toToolChoice("auto")).toBe("auto")
  expect(Convert.toToolChoice({ type: "function", function: { name: "ping" } })).toEqual({
    type: "tool",
    toolName: "ping",
  })
  expect(Convert.toToolChoice(undefined)).toBeUndefined()
})

test("convertRequest drops temperature for models that do not support it and clamps max tokens", () => {
  const model = { capabilities: { temperature: false }, limit: { output: 100 } } as never
  const converted = Convert.convertRequest(
    { model: "x/y", messages: [{ role: "user", content: "hi" }], temperature: 0.7, max_tokens: 9999 },
    model,
  )
  expect(converted.temperature).toBeUndefined()
  expect(converted.maxOutputTokens).toBe(100)
})

test("toSseStream emits text deltas, finish_reason and [DONE]", async () => {
  const frames = await collect(
    Convert.toSseStream(
      fromParts([
        { type: "text-delta", text: "Hel" },
        { type: "text-delta", text: "lo" },
        { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      ]),
      meta,
    ),
  )
  const lines = parseChunks(frames)
  expect(lines.at(-1)).toBe("[DONE]")
  const chunks = lines.slice(0, -1).map((l) => JSON.parse(l))
  expect(chunks[0].choices[0].delta.role).toBe("assistant")
  expect(chunks.map((c) => c.choices[0]?.delta?.content).filter(Boolean).join("")).toBe("Hello")
  const finish = chunks.find((c) => c.choices[0]?.finish_reason)
  expect(finish.choices[0].finish_reason).toBe("stop")
})

test("toSseStream streams tool calls and maps tool-calls finish reason", async () => {
  const frames = await collect(
    Convert.toSseStream(
      fromParts([
        { type: "tool-input-start", id: "c1", toolName: "search" },
        { type: "tool-input-delta", id: "c1", delta: '{"q":' },
        { type: "tool-input-delta", id: "c1", delta: '"x"}' },
        { type: "finish", finishReason: "tool-calls", totalUsage: {} },
      ]),
      meta,
    ),
  )
  const chunks = parseChunks(frames)
    .filter((l) => l !== "[DONE]")
    .map((l) => JSON.parse(l))
  const toolDeltas = chunks.flatMap((c) => c.choices[0]?.delta?.tool_calls ?? [])
  expect(toolDeltas[0]).toMatchObject({ index: 0, id: "c1", type: "function", function: { name: "search" } })
  const args = toolDeltas.map((t) => t.function?.arguments ?? "").join("")
  expect(args).toBe('{"q":"x"}')
  expect(chunks.find((c) => c.choices[0]?.finish_reason).choices[0].finish_reason).toBe("tool_calls")
})

test("aggregate builds a single completion with null content for tool-only replies", async () => {
  const completion = await Convert.aggregate(
    fromParts([
      { type: "tool-call", toolCallId: "c1", toolName: "search", input: { q: "x" } },
      { type: "finish", finishReason: "tool-calls", totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]),
    meta,
  )
  expect(completion.object).toBe("chat.completion")
  expect(completion.choices[0].message.content).toBeNull()
  expect(completion.choices[0].message.tool_calls?.[0]).toEqual({
    id: "c1",
    type: "function",
    function: { name: "search", arguments: '{"q":"x"}' },
  })
  expect(completion.choices[0].finish_reason).toBe("tool_calls")
  expect(completion.usage.total_tokens).toBe(2)
})

test("aggregate concatenates text", async () => {
  const completion = await Convert.aggregate(
    fromParts([
      { type: "text-delta", text: "a" },
      { type: "text-delta", text: "b" },
      { type: "finish", finishReason: "stop", totalUsage: {} },
    ]),
    meta,
  )
  expect(completion.choices[0].message.content).toBe("ab")
  expect(completion.choices[0].message.tool_calls).toBeUndefined()
})
