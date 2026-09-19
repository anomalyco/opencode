import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { expect, test } from "bun:test"

test("openai-compatible synthesizes missing tool-call IDs while streaming", async () => {
  const chunks = [
    {
      id: "response-1",
      created: 0,
      model: "zai-glm-5-2",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { name: "bash", arguments: '{"command":"ls' },
              },
            ],
          },
        },
      ],
    },
    {
      id: "response-1",
      created: 0,
      model: "zai-glm-5-2",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { name: "", arguments: ' -l"}' },
              },
            ],
          },
        },
      ],
    },
    {
      id: "response-1",
      created: 0,
      model: "zai-glm-5-2",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]
  const mockFetch = Object.assign(
    async () =>
      new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    { preconnect: fetch.preconnect },
  )
  const provider = createOpenAICompatible({
    apiKey: "test",
    baseURL: "https://api.mistral.ai/v1",
    name: "mistral",
    fetch: mockFetch,
  })
  const model = provider("zai-glm-5-2")
  const result = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "list files" }] }],
  })
  const events = []
  for await (const event of result.stream) events.push(event)

  const toolInputStart = events.find((event) => event.type === "tool-input-start")
  const toolCall = events.find((event) => event.type === "tool-call")
  const errors = events.filter((event) => event.type === "error")

  expect(errors).toEqual([])
  expect(toolInputStart).toBeDefined()
  expect(toolCall).toBeDefined()
  expect(typeof toolInputStart?.id).toBe("string")
  expect(toolCall?.toolCallId).toBe(toolInputStart?.id)
  expect(toolCall?.toolName).toBe("bash")
  expect(JSON.parse(toolCall?.input ?? "{}")).toEqual({ command: "ls -l" })
})

test("openai-compatible uses provided tool-call IDs while streaming", async () => {
  const chunks = [
    {
      id: "response-1",
      created: 0,
      model: "test-model",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                id: "call_abc123",
                index: 0,
                function: { name: "bash", arguments: '{"command":"ls"}' },
              },
            ],
          },
        },
      ],
    },
    {
      id: "response-1",
      created: 0,
      model: "test-model",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]
  const mockFetch = Object.assign(
    async () =>
      new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    { preconnect: fetch.preconnect },
  )
  const provider = createOpenAICompatible({
    apiKey: "test",
    baseURL: "https://example.com/v1",
    name: "test",
    fetch: mockFetch,
  })
  const model = provider("test-model")
  const result = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "list files" }] }],
  })
  const events = []
  for await (const event of result.stream) events.push(event)

  const toolCall = events.find((event) => event.type === "tool-call")
  expect(toolCall?.toolCallId).toBe("call_abc123")
})
