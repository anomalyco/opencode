import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModelV2Prompt } from "@ai-sdk/provider"
import { describe, expect, mock, test } from "bun:test"

async function read<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader()
  const parts: T[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]
const args = `{"command":"ls","description":"Lists files in current directory"}`

const fixtures = {
  delta: [
    `data: {"id":"chatcmpl-glm-delta","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_glm_delta","index":0,"function":{"name":"bash","arguments":"{\\"command\\":\\""}}],"content":null},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-glm-delta","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"id":null,"index":0,"function":{"name":null,"arguments":"ls\\""}}],"content":null},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-glm-delta","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"id":null,"index":0,"function":{"name":null,"arguments":",\\"description\\":\\"Lists files in current directory\\""}}],"content":null},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-glm-delta","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"id":null,"index":0,"function":{"name":null,"arguments":"}"}}],"content":null},"finish_reason":"tool_calls"}]}`,
    `data: [DONE]`,
  ],
  repeat: [
    `data: {"id":"chatcmpl-glm-repeat","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_glm_repeat","index":0,"function":{"name":"bash","arguments":"{\\"command\\":\\""}}],"content":null},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-glm-repeat","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"id":null,"index":0,"function":{"name":null,"arguments":"ls\\""}}],"content":null},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-glm-repeat","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"id":null,"index":0,"function":{"name":null,"arguments":",\\"description\\":\\"Lists files in current directory\\""}}],"content":null},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-glm-repeat","object":"chat.completion.chunk","created":1677652288,"model":"glm-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"id":null,"index":0,"function":{"name":null,"arguments":"{\\"command\\":\\"ls\\",\\"description\\":\\"Lists files in current directory\\"}"}}],"content":null},"finish_reason":"tool_calls"}]}`,
    `data: [DONE]`,
  ],
}

function stub(chunks: string[]) {
  return mock(async () => {
    const body = new ReadableStream({
      start(ctrl) {
        for (const chunk of chunks) {
          ctrl.enqueue(new TextEncoder().encode(chunk + "\n\n"))
        }
        ctrl.close()
      },
    })

    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  })
}

function model(fn: ReturnType<typeof stub>) {
  return createOpenAICompatible({
    name: "test",
    baseURL: "https://api.test.com/v1",
    apiKey: "test-token",
    fetch: fn as any,
  }).chatModel("test-model")
}

describe("openai-compatible streamed tool arguments", () => {
  test("keeps delta-only chunks unchanged", async () => {
    const { stream } = await model(stub(fixtures.delta)).doStream({
      prompt,
      includeRawChunks: false,
    })

    const parts = await read(stream)
    const deltas = parts.filter((part) => part.type === "tool-input-delta")

    expect(deltas).toMatchObject([
      { type: "tool-input-delta", id: "call_glm_delta", delta: "{\"command\":\"" },
      { type: "tool-input-delta", id: "call_glm_delta", delta: "ls\"" },
      {
        type: "tool-input-delta",
        id: "call_glm_delta",
        delta: ",\"description\":\"Lists files in current directory\"",
      },
      { type: "tool-input-delta", id: "call_glm_delta", delta: "}" },
    ])

    const part = parts.find((item) => item.type === "tool-call" && item.toolCallId === "call_glm_delta")
    expect(part).toMatchObject({
      type: "tool-call",
      toolCallId: "call_glm_delta",
      toolName: "bash",
      input: args,
    })
  })

  test("replaces partial chunks with a repeated final payload", async () => {
    const { stream } = await model(stub(fixtures.repeat)).doStream({
      prompt,
      includeRawChunks: false,
    })

    const parts = await read(stream)
    const part = parts.find((item) => item.type === "tool-call" && item.toolCallId === "call_glm_repeat")

    expect(part).toMatchObject({
      type: "tool-call",
      toolCallId: "call_glm_repeat",
      toolName: "bash",
      input: args,
    })
    expect(JSON.parse((part as { input: string }).input)).toEqual({
      command: "ls",
      description: "Lists files in current directory",
    })
  })
})
