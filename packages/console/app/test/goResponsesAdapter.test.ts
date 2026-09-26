import { describe, expect, test } from "bun:test"
import {
  toChatHttpRequest,
  toChatRequest,
  toResponsesResult,
  toResponsesStream,
} from "../src/routes/zen/go/v1/responses-adapter"

describe("Go GLM Responses adapter", () => {
  test("replays Codex tools over multiple turns with matching call IDs", () => {
    const chat = toChatRequest({
      model: "glm-5.3",
      instructions: "Be concise",
      stream: true,
      input: [
        { role: "user", content: [{ type: "input_text", text: "Read the file" }] },
        { type: "function_call", id: "fc_item", call_id: "call_1", name: "read_file", arguments: '{"path":"a"}' },
        { type: "function_call_output", call_id: "call_1", output: "contents" },
        { type: "reasoning", summary: [] },
        { role: "assistant", content: [] },
        { role: "assistant", content: [{ type: "output_text", text: "It says hello." }] },
        { role: "user", content: [{ type: "input_text", text: "Now summarize" }] },
      ],
      tools: [{ type: "function", name: "read_file", parameters: { type: "object" } }],
      tool_choice: { type: "function", name: "read_file" },
    })

    expect(chat.messages).toEqual([
      { role: "system", content: "Be concise" },
      { role: "user", content: "Read the file" },
      {
        role: "assistant",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "contents" },
      { role: "assistant", content: "It says hello." },
      { role: "user", content: "Now summarize" },
    ])
    expect(chat.tools).toEqual([{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }])
    expect(chat.tool_choice).toEqual({ type: "function", function: { name: "read_file" } })
    expect(chat.stream_options).toEqual({ include_usage: true })
  })

  test("retains native Codex headers at the chat gateway", async () => {
    const request = new Request("https://opencode.ai/zen/go/v1/responses", {
      method: "POST",
      headers: { authorization: "Bearer example", "session-id": "session-a", "thread-id": "thread-b" },
      body: "{}",
    })
    const converted = toChatHttpRequest(request, toChatRequest({ model: "glm-5.3-flash", input: "hello" }))
    expect(new URL(converted.url).pathname).toBe("/zen/go/v1/chat/completions")
    expect(converted.headers.get("session-id")).toBe("session-a")
    expect(converted.headers.get("thread-id")).toBe("thread-b")
    expect(converted.headers.get("authorization")).toBe("Bearer example")
    expect((await converted.json()).messages).toEqual([{ role: "user", content: "hello" }])
  })

  test("maps nonstreaming tool output and zero cached tokens", () => {
    const result = toResponsesResult(
      {
        id: "chatcmpl_123",
        choices: [
          { message: { tool_calls: [{ id: "call_a", type: "function", function: { name: "run", arguments: "{}" } }] } },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
      },
      "glm-5.3",
    )
    expect(result.id).toBe("resp_123")
    expect(result.output[0]).toMatchObject({ type: "function_call", call_id: "call_a", name: "run" })
    expect(result.usage).toMatchObject({
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 0 },
      total_tokens: 16,
    })
  })

  test("emits ordered SSE items, interleaved tool calls, and final usage", async () => {
    const chunks = [
      { id: "chatcmpl_1", created: 42, choices: [{ delta: { content: "Hello" } }] },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "first", arguments: "" } }] } }],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "second", arguments: "" } }] } }],
      },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"b":2}' } }] } }] },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] }, finish_reason: "tool_calls" },
        ],
      },
      {
        choices: [],
        usage: { prompt_tokens: 30, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 20 } },
      },
    ]
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        const data = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
        const bytes = new TextEncoder().encode(data)
        controller.enqueue(bytes.subarray(0, 23))
        controller.enqueue(bytes.subarray(23))
        controller.close()
      },
    })
    const wire = await new Response(toResponsesStream(source, "glm-5.3-flash")).text()
    const events = wire.split("\n\n").filter((event) => event.startsWith("event:"))
    const parsed = events.map((event) => JSON.parse(event.split("data: ")[1]))
    expect(parsed.map((event) => event.type)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_item.added",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ])
    expect(parsed.map((event) => event.sequence_number)).toEqual(parsed.map((_, index) => index))
    const result = parsed.at(-1).response
    expect(
      parsed.filter((event) => event.output_index !== undefined).every((event) => event.response_id === result.id),
    ).toBe(true)
    expect(result.output.map((item: { type: string }) => item.type)).toEqual([
      "message",
      "function_call",
      "function_call",
    ])
    expect(result.output[1]).toMatchObject({ call_id: "call_a", arguments: '{"a":1}' })
    expect(result.output[2]).toMatchObject({ call_id: "call_b", arguments: '{"b":2}' })
    expect(result.usage).toMatchObject({
      input_tokens: 30,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 10,
    })
    expect(wire.endsWith("data: [DONE]\n\n")).toBe(true)
  })

  test("does not report an empty upstream stream as a successful turn", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
        controller.close()
      },
    })
    expect(new Response(toResponsesStream(source, "glm-5.3")).text()).rejects.toThrow(
      "Chat stream ended without a completion",
    )
  })
})
