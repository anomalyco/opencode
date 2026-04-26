import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
import { OpenAICompatibleChat } from "../../src/provider/openai-compatible-chat"
import { testEffect } from "../lib/effect"
import { dynamicResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)

const model = OpenAICompatibleChat.model({
  id: "deepseek-chat",
  provider: "deepseek",
  baseURL: "https://api.deepseek.test/v1/",
  apiKey: "test-key",
  queryParams: { "api-version": "2026-01-01" },
})

const request = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

const it = testEffect(Layer.empty)

const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_fixture",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

const usageChunk = (usage: object) => ({
  id: "chatcmpl_fixture",
  choices: [],
  usage,
})

describe("OpenAI-compatible Chat adapter", () => {
  it.effect("prepares generic Chat target", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [OpenAICompatibleChat.adapter] }).prepare(
        LLM.request({
          ...request,
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
          toolChoice: { type: "required" },
        }),
      )

      expect(prepared.adapter).toBe("openai-compatible-chat")
      expect(prepared.model).toMatchObject({
        id: "deepseek-chat",
        provider: "deepseek",
        protocol: "openai-compatible-chat",
        baseURL: "https://api.deepseek.test/v1/",
        headers: { authorization: "Bearer test-key" },
        native: { queryParams: { "api-version": "2026-01-01" } },
      })
      expect(prepared.target).toEqual({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        tools: [{ type: "function", function: { name: "lookup", description: "Lookup data", parameters: { type: "object" } } }],
        tool_choice: "required",
        stream: true,
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("posts to the configured compatible endpoint and parses text usage", () =>
    Effect.gen(function* () {
      const response = yield* client({
        adapters: [OpenAICompatibleChat.adapter.withPatches([OpenAICompatibleChat.includeUsage])],
      })
        .generate(request)
        .pipe(
          Effect.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(web.url).toBe("https://api.deepseek.test/v1/chat/completions?api-version=2026-01-01")
                expect(web.headers.get("authorization")).toBe("Bearer test-key")
                expect(decodeJson(input.text)).toMatchObject({
                  model: "deepseek-chat",
                  stream: true,
                  stream_options: { include_usage: true },
                  messages: [
                    { role: "system", content: "You are concise." },
                    { role: "user", content: "Say hello." },
                  ],
                })
                return new Response(
                  sseEvents(
                    deltaChunk({ role: "assistant", content: "Hello" }),
                    deltaChunk({ content: "!" }),
                    deltaChunk({}, "stop"),
                    usageChunk({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }),
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              }),
            ),
          ),
        )

      expect(LLM.outputText(response)).toBe("Hello!")
      expect(LLM.outputUsage(response)).toMatchObject({ inputTokens: 5, outputTokens: 2, totalTokens: 7 })
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )
})
