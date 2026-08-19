import { describe, expect, test } from "bun:test"
import { createToOpenaiChunk } from "../src/routes/zen/util/provider/openai"
import { fromOaCompatibleChunk } from "../src/routes/zen/util/provider/openai-compatible"

function convert(chunks: string[]) {
  const toOpenai = createToOpenaiChunk()
  return chunks
    .map((part) => {
      const raw = fromOaCompatibleChunk(part)
      return typeof raw === "string" ? raw : toOpenai(raw)
    })
    .filter((part) => part.length > 0)
    .join("\n\n")
}

const chunk = (delta: string, finishReason?: string, usage?: Record<string, unknown>) =>
  JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "deepseek-v4-flash",
    choices: [{ index: 0, delta: JSON.parse(delta), finish_reason: finishReason ?? null }],
    ...(usage ? { usage } : {}),
  })

const eventOrder = (stream: string) => [...stream.matchAll(/event: ([a-z_.]+)/g)].map((m) => m[1])

const eventData = (stream: string, event: string) => {
  const match = stream.match(new RegExp(`event: ${event}\\ndata: (\\{.*?\\})(?:\\n\\n|$)`))
  if (!match) throw new Error(`missing ${event}`)
  return JSON.parse(match[1])
}

describe("createToOpenaiChunk", () => {
  test("text stream emits the full Responses-API lifecycle in order", () => {
    const stream = convert([
      `data: ${chunk('{"role":"assistant","content":""}')}`,
      `data: ${chunk('{"content":"ok"}')}`,
      `data: ${chunk('{"content":"!"}')}`,
      `data: ${chunk("{}", "stop", { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 })}`,
      "data: [DONE]",
    ])

    expect(eventOrder(stream)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_item.done",
      "response.completed",
    ])
    expect((stream.match(/event: response\.created/g) ?? []).length).toBe(1)
    expect(stream).toContain("data: [DONE]")

    const item = eventData(stream, "response.output_item.done").item
    expect(item).toMatchObject({ type: "message", status: "completed", role: "assistant" })
    expect(item.content[0].text).toBe("ok!")

    const completed = eventData(stream, "response.completed").response
    expect(completed.output[0].content[0].text).toBe("ok!")
    expect(completed.usage).toEqual({
      input_tokens: 10,
      output_tokens: 3,
      total_tokens: 13,
    })
  })

  test("[DONE] passes through unchanged", () => {
    expect(convert(["data: [DONE]"])).toBe("data: [DONE]")
  })

  test("tool call stream emits the function-call lifecycle", () => {
    const stream = convert([
      `data: ${chunk('{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}')}`,
      `data: ${chunk('{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}')}`,
      `data: ${chunk('{"tool_calls":[{"index":0,"function":{"arguments":"\\"Sydney\\""}}]}')}`,
      `data: ${chunk('{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}')}`,
      `data: ${chunk("{}", "tool_calls")}`,
    ])

    expect(eventOrder(stream)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ])

    const item = eventData(stream, "response.output_item.done").item
    expect(item).toMatchObject({ type: "function_call", name: "get_weather" })
    expect(item.arguments).toBe('{"city":"Sydney"}')
  })

  test("stream with no visible text still opens and closes the response", () => {
    const stream = convert([`data: ${chunk("{}", "stop")}`])
    expect(eventOrder(stream)).toEqual(["response.created", "response.in_progress", "response.completed"])
    expect(eventData(stream, "response.completed").response.output).toEqual([])
  })
})
