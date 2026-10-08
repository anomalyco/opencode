import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM } from "../../src/index.js"
import { compileRequest } from "../../src/route/client.js"
import { DigitalOcean } from "../../src/providers/digitalocean.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"
import { LLMClient } from "../../src/route.js"

describe("DigitalOcean", () => {
  test("preserves package entrypoint headers and body overrides", () => {
    const model = DigitalOcean.model("anthropic-claude-fable-5.1", {
      apiKey: "test-key",
      headers: { "X-Test": "fixture" },
      body: { temperature: 0 },
    })
    expect(model.route.defaults?.http).toMatchObject({
      headers: { "X-Test": "fixture" },
      body: { temperature: 0 },
    })
  })

  it.effect("prepares DigitalOcean models with default endpoint and auth", () =>
    Effect.gen(function* () {
      const model = DigitalOcean.configure({ apiKey: "test-key" }).model("anthropic-claude-fable-5.1")

      expect(model).toMatchObject({
        id: "anthropic-claude-fable-5.1",
        provider: "digitalocean",
        route: { id: "digitalocean" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://inference.do-ai.run/v1")

      const prepared = yield* compileRequest(LLM.request({ model, prompt: "Say hello.", cache: "none" }))

      expect(prepared.route).toBe("digitalocean")
      expect(prepared.body).toMatchObject({
        model: "anthropic-claude-fable-5.1",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("lowers the native cache policy to DigitalOcean cache_control markers", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: DigitalOcean.configure({ apiKey: "test-key" }).model("anthropic-claude-fable-5.1"),
          system: [
            { type: "text", text: "Base agent", cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3_600 }) },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
          prompt: "Hello",
          cache: { tools: true, system: true, messages: { tail: 1 } },
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "system",
            content: [
              { text: "Base agent", cache_control: { type: "ephemeral", ttl: "1h" } },
              { text: "Project instructions", cache_control: { type: "ephemeral" } },
            ],
          },
          {
            role: "user",
            content: [{ text: "Hello", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("parses DigitalOcean cache usage fields into AI.Usage", () =>
    Effect.gen(function* () {
      const model = DigitalOcean.configure({ apiKey: "test-key" }).model("anthropic-claude-fable-5.1")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Say OK" })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                id: "chatcmpl-1",
                object: "chat.completion.chunk",
                created: 1,
                model: "anthropic-claude-fable-5.1",
                choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }],
              },
              {
                id: "chatcmpl-1",
                object: "chat.completion.chunk",
                created: 1,
                model: "anthropic-claude-fable-5.1",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: 4491,
                  completion_tokens: 8,
                  total_tokens: 4499,
                  cache_read_input_tokens: 4483,
                  cache_created_input_tokens: 0,
                },
              },
              "[DONE]",
            ),
          ),
        ),
      )

      expect(response.usage).toMatchObject({
        inputTokens: 4491,
        outputTokens: 8,
        nonCachedInputTokens: 8,
        cacheReadInputTokens: 4483,
        totalTokens: 4499,
      })
    }),
  )
})
