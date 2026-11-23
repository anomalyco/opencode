import { afterAll, describe, expect, test } from "bun:test"
import { generateText, streamText } from "ai"
import { createOpenCode, protocol } from "../src/index.js"

const billing = {
  cost: 0.000079,
  opencode: {
    billing_source: "balance",
    list_cost: 0.000079,
    tokens: { input: 9, output: 14, reasoning: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 },
  },
}
const usage = {
  cost: 0.000079,
  listCost: 0.000079,
  billingSource: "balance",
  tokens: { input: 9, output: 14, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
}

const sse = (events: ReadonlyArray<unknown>) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  })

const requests: string[] = []
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    requests.push(url.pathname)
    const body = await request.json()
    if (url.pathname === "/anthropic/v1/messages") {
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "Hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 9, output_tokens: 14, ...billing },
      })
    }
    const chunk = { id: "c1", object: "chat.completion.chunk", created: 1, model: body.model }
    if (body.stream)
      return sse([
        { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }] },
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { ...chunk, choices: [], usage: { prompt_tokens: 9, completion_tokens: 14, total_tokens: 23, ...billing } },
      ])
    return Response.json({
      ...chunk,
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 9, completion_tokens: 14, total_tokens: 23, ...billing },
    })
  },
})
afterAll(() => server.stop(true))

const opencode = createOpenCode({ apiKey: "test", baseURL: server.url.href })

describe("protocol", () => {
  test("uses the protocol the model list names", () => {
    expect(protocol("qwen3.6-plus")).toBe("messages")
    expect(protocol("grok-4.7")).toBe("responses")
  })

  test("guesses an unlisted model's protocol from the last part of its name", () => {
    expect(protocol("console-openrouter/anthropic/claude-sonnet-4-6")).toBe("messages")
    expect(protocol("console-azure/gpt-7")).toBe("responses")
    expect(protocol("console-vertex/gemini-9-pro")).toBe("google")
    expect(protocol("console-groq/gpt-oss-120b")).toBe("chat")
    expect(protocol("console-acme/some-model")).toBe("chat")
  })
})

describe("usage", () => {
  test("generate reports OpenCode's billing in providerMetadata.opencode.usage", async () => {
    const result = await generateText({ model: opencode.chat("deepseek-v4.1-flash"), prompt: "hi" })
    expect(result.providerMetadata?.opencode?.usage).toEqual(usage)
  })

  test("a stream reports it on finish", async () => {
    const result = streamText({ model: opencode.chat("deepseek-v4.1-flash"), prompt: "hi" })
    await result.consumeStream()
    expect((await result.providerMetadata)?.opencode?.usage).toEqual(usage)
  })

  test("a stream passes raw chunks on only when the caller asks", async () => {
    const parts = (includeRawChunks: boolean) =>
      opencode
        .chat("deepseek-v4.1-flash")
        .doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }], includeRawChunks })
        .then((result) => Array.fromAsync(result.stream))
    expect((await parts(false)).some((part) => part.type === "raw")).toBe(false)
    expect((await parts(true)).some((part) => part.type === "raw")).toBe(true)
  })

  test("a model's native protocol carries it too", async () => {
    const result = await generateText({ model: opencode("claude-haiku-4-5"), prompt: "hi" })
    expect(requests.at(-1)).toBe("/anthropic/v1/messages")
    expect(result.providerMetadata?.opencode?.usage).toEqual(usage)
  })
})
