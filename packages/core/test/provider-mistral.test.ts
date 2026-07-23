import { createMistral } from "@ai-sdk/mistral"
import { expect, test } from "bun:test"

test("Mistral sends promptCacheKey as prompt_cache_key", async () => {
  let body: Record<string, unknown> | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "response-1",
        created: 0,
        model: "mistral-large-latest",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createMistral({ apiKey: "test", fetch: mockFetch })("mistral-large-latest")

  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    providerOptions: { mistral: { promptCacheKey: "session-123" } },
  })

  expect(body?.prompt_cache_key).toBe("session-123")
})

test("Mistral preserves structured reasoning in assistant history", async () => {
  let body: { messages?: unknown[] } | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "response-1",
        created: 0,
        model: "mistral-small-latest",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createMistral({ apiKey: "test", fetch: mockFetch })("mistral-small-latest")

  await model.doGenerate({
    prompt: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "The user is greeting me." },
          { type: "text", text: "Hi" },
        ],
      },
      { role: "user", content: [{ type: "text", text: "Hello again" }] },
    ],
  })

  expect(body?.messages?.[1]).toEqual({
    role: "assistant",
    content: [
      {
        type: "thinking",
        thinking: [{ type: "text", text: "The user is greeting me." }],
      },
      { type: "text", text: "Hi" },
    ],
  })
})
