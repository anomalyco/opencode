import { createMistral } from "@ai-sdk/mistral"
import { expect, test } from "bun:test"

test.each([false, true])(
  "Mistral accumulates fragmented tool calls with native reasoning (parallel: %s)",
  async (parallel) => {
    const thinking = {
      type: "thinking" as const,
      thinking: [{ type: "text", text: "Check the weather." }],
      closed: true,
      signature: "sig-123",
    }
    const calls = ["Paris", ...(parallel ? ["London"] : [])].map((city, index) => ({
      index,
      id: `call0000${index}`,
      city,
    }))
    const chunks = [
      { content: [thinking] },
      {
        tool_calls: calls.map((call) => ({
          index: call.index,
          id: call.id,
          type: "function",
          function: { name: "weather", arguments: '{"city":"' },
        })),
      },
      ...calls.toReversed().map((call) => ({
        content: "",
        tool_calls: [{ index: call.index, function: { name: "", arguments: call.city } }],
      })),
      { tool_calls: calls.map((call) => ({ index: call.index, function: { arguments: '"}' } })) },
    ].map((delta) => ({
      id: "response-1",
      created: 0,
      model: "zai-glm-5-2",
      choices: [{ index: 0, delta }],
    }))
    const body: { messages?: unknown[] }[] = []
    const mockFetch = Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (typeof init?.body !== "string") throw new Error("Expected JSON request body")
        body.push(JSON.parse(init.body))
        return new Response(
          [...chunks, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        )
      },
      { preconnect: fetch.preconnect },
    )
    const model = createMistral({ apiKey: "test", fetch: mockFetch })("zai-glm-5-2")
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Check the weather" }] }],
    })
    const events = []
    for await (const event of result.stream) events.push(event)

    expect(events.filter((event) => event.type === "error")).toEqual([])
    const tools = events.filter((event) => event.type === "tool-call")
    expect(tools).toEqual(
      calls.map((call) => ({
        type: "tool-call",
        toolCallId: call.id,
        toolName: "weather",
        input: JSON.stringify({ city: call.city }),
      })),
    )
    expect(events.filter((event) => event.type === "tool-input-start")).toHaveLength(calls.length)
    expect(events.filter((event) => event.type === "tool-input-end")).toHaveLength(calls.length)
    const reasoning = events.find((event) => event.type === "reasoning-end")
    expect(reasoning?.providerMetadata).toEqual({ mistral: { thinking } })

    const next = await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "Check the weather" }] },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Check the weather.", providerOptions: reasoning?.providerMetadata },
            ...tools.map((tool) => ({ ...tool, input: JSON.parse(tool.input) })),
          ],
        },
        {
          role: "tool",
          content: tools.map((tool) => ({
            type: "tool-result",
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            output: { type: "text", value: "Sunny" },
          })),
        },
      ],
    })
    await next.stream.cancel()
    expect(body[1]?.messages?.slice(1)).toEqual([
      {
        role: "assistant",
        content: [thinking],
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: "weather", arguments: JSON.stringify({ city: call.city }) },
        })),
      },
      ...calls.map((call) => ({ role: "tool", name: "weather", tool_call_id: call.id, content: "Sunny" })),
    ])
  },
)

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

test("Mistral passes through unknown reasoning effort", async () => {
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
    providerOptions: { mistral: { reasoningEffort: "custom" } },
  })

  expect(body?.reasoning_effort).toBe("custom")
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
  expect(body?.messages?.[1]).toEqual({
    role: "assistant",
    content: [
      { type: "thinking", thinking: [{ type: "text", text: "thinking" }], closed: true },
      { type: "text", text: "Hi" },
    ],
  })
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
