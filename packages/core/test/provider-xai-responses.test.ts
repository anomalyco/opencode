import { createXai } from "@ai-sdk/xai"
import { expect, test } from "bun:test"

test("xAI Responses sends promptCacheKey as prompt_cache_key", async () => {
  let body: Record<string, unknown> | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "response-1",
        created_at: 0,
        model: "grok-4",
        object: "response",
        output: [],
        usage: { input_tokens: 1, output_tokens: 0 },
        status: "completed",
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createXai({
    apiKey: "test",
    fetch: mockFetch,
  }).responses("grok-4")

  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    providerOptions: { xai: { promptCacheKey: "session-123" } },
  })

  expect(body?.prompt_cache_key).toBe("session-123")
})
