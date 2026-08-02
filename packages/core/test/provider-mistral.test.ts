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

test("Mistral round-trips native reasoning in assistant history", async () => {
  let body: { messages?: unknown[] } | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "response-1",
        created: 0,
        model: "mistral-small-latest",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: [
                {
                  type: "thinking",
                  thinking: [
                    { type: "text", text: "The user is greeting me." },
                    {
                      type: "tool_reference",
                      tool: "web_search",
                      title: "Example result",
                      url: "https://example.com/tool",
                      favicon: "https://example.com/favicon.ico",
                      description: "Example description",
                    },
                    { type: "reference", reference_ids: [1, "source-2"] },
                  ],
                  closed: true,
                  signature: "sig-123",
                },
                { type: "text", text: "Hi" },
              ],
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createMistral({ apiKey: "test", fetch: mockFetch })("mistral-small-latest")

  const first = await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  })
  const reasoning = first.content.find((part) => part.type === "reasoning")
  const text = first.content.find((part) => part.type === "text")
  if (!reasoning || !text) throw new Error("expected reasoning and text")

  await model.doGenerate({
    prompt: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        content: [{ ...reasoning, providerOptions: reasoning.providerMetadata }, text],
      },
      { role: "user", content: [{ type: "text", text: "Hello again" }] },
    ],
  })

  expect(body?.messages?.[1]).toEqual({
    role: "assistant",
    content: [
      {
        type: "thinking",
        thinking: [
          { type: "text", text: "The user is greeting me." },
          {
            type: "tool_reference",
            tool: "web_search",
            title: "Example result",
            url: "https://example.com/tool",
            favicon: "https://example.com/favicon.ico",
            description: "Example description",
          },
          { type: "reference", reference_ids: [1, "source-2"] },
        ],
        closed: true,
        signature: "sig-123",
      },
      { type: "text", text: "Hi" },
    ],
  })

  await model.doGenerate({
    prompt: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "Hi" },
        ],
      },
      { role: "user", content: [{ type: "text", text: "Hello again" }] },
    ],
  })
  expect(body?.messages?.[1]).toEqual({ role: "assistant", content: "thinkingHi" })
})

test("Mistral preserves native reasoning metadata while streaming", async () => {
  const chunks = [
    {
      id: "response-1",
      created: 0,
      model: "mistral-small-latest",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: [
                  { type: "text", text: "thinking" },
                  {
                    type: "tool_reference",
                    tool: "web_search",
                    title: "Example result",
                    url: "https://example.com/tool",
                    favicon: "https://example.com/favicon.ico",
                    description: "Example description",
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      id: "response-1",
      created: 0,
      model: "mistral-small-latest",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              {
                type: "thinking",
                thinking: [{ type: "reference", reference_ids: [1, "source-2"] }],
                closed: true,
                signature: "sig-123",
              },
            ],
          },
        },
      ],
    },
    {
      id: "response-1",
      created: 0,
      model: "mistral-small-latest",
      choices: [{ index: 0, delta: { content: [{ type: "text", text: "answer" }] } }],
    },
    {
      id: "response-1",
      created: 0,
      model: "mistral-small-latest",
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
  const model = createMistral({ apiKey: "test", fetch: mockFetch })("mistral-small-latest")
  const result = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  })
  const events = []
  for await (const event of result.stream) events.push(event)

  expect(events.find((event) => event.type === "reasoning-end")?.providerMetadata).toEqual({
    mistral: {
      thinking: {
        type: "thinking",
        thinking: [
          { type: "text", text: "thinking" },
          {
            type: "tool_reference",
            tool: "web_search",
            title: "Example result",
            url: "https://example.com/tool",
            favicon: "https://example.com/favicon.ico",
            description: "Example description",
          },
          { type: "reference", reference_ids: [1, "source-2"] },
        ],
        closed: true,
        signature: "sig-123",
      },
    },
  })
  expect(
    events
      .filter((event) => event.type === "reasoning-start" || event.type === "reasoning-delta")
      .every((event) => event.providerMetadata === undefined),
  ).toBe(true)
})

test("Mistral preserves metadata-only thinking chunks", async () => {
  const thinking = {
    type: "thinking" as const,
    thinking: [
      {
        type: "tool_reference",
        tool: "web_search",
        title: "Example result",
        url: "https://example.com/tool",
        favicon: "https://example.com/favicon.ico",
        description: "Example description",
      },
      { type: "reference", reference_ids: [1, "source-2"] },
    ],
    closed: true,
    signature: "sig-123",
  }
  const mockFetch = Object.assign(
    async () =>
      Response.json({
        id: "response-1",
        created: 0,
        model: "mistral-small-latest",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: [thinking] }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    { preconnect: fetch.preconnect },
  )
  const model = createMistral({ apiKey: "test", fetch: mockFetch })("mistral-small-latest")
  const result = await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  })

  expect(result.content).toEqual([
    {
      type: "reasoning",
      text: "",
      providerMetadata: { mistral: { thinking } },
    },
  ])
})
