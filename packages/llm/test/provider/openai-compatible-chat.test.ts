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

const providerFamilies = [
  ["baseten", OpenAICompatibleChat.baseten, "https://inference.baseten.co/v1"],
  ["cerebras", OpenAICompatibleChat.cerebras, "https://api.cerebras.ai/v1"],
  ["deepinfra", OpenAICompatibleChat.deepinfra, "https://api.deepinfra.com/v1/openai"],
  ["deepseek", OpenAICompatibleChat.deepseek, "https://api.deepseek.com/v1"],
  ["fireworks", OpenAICompatibleChat.fireworks, "https://api.fireworks.ai/inference/v1"],
  ["togetherai", OpenAICompatibleChat.togetherai, "https://api.together.xyz/v1"],
] as const

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

  it.effect("provides model helpers for compatible provider families", () =>
    Effect.gen(function* () {
      expect(
        providerFamilies.map(([provider, makeModel, baseURL]) => {
          const model = makeModel({ id: `${provider}-model`, apiKey: "test-key" })
          return {
            id: model.id,
            provider: model.provider,
            protocol: model.protocol,
            baseURL: model.baseURL,
            headers: model.headers,
            native: model.native,
          }
        }),
      ).toEqual(
        providerFamilies.map(([provider, _, baseURL]) => ({
          id: `${provider}-model`,
          provider,
          protocol: "openai-compatible-chat",
          baseURL,
          headers: { authorization: "Bearer test-key" },
          native: { openaiCompatibleProvider: provider },
        })),
      )

      const custom = OpenAICompatibleChat.deepseek({
        id: "deepseek-chat",
        apiKey: "test-key",
        baseURL: "https://custom.deepseek.test/v1",
      })
      expect(custom).toMatchObject({
        provider: "deepseek",
        protocol: "openai-compatible-chat",
        baseURL: "https://custom.deepseek.test/v1",
        native: { openaiCompatibleProvider: "deepseek" },
      })
    }),
  )

  it.effect("matches AI SDK compatible basic request body fixture", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [OpenAICompatibleChat.adapter] }).prepare(request)

      expect(prepared.target).toEqual({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        stream: true,
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("matches AI SDK compatible tool request body fixture", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [OpenAICompatibleChat.adapter] }).prepare(
        LLM.request({
          id: "req_tool_parity",
          model,
          tools: [{
            name: "lookup",
            description: "Lookup data",
            inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          }],
          toolChoice: "lookup",
          messages: [
            LLM.user("What is the weather?"),
            LLM.assistant([LLM.toolCall({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            LLM.toolMessage({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.target).toEqual({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: "What is the weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"query":"weather"}' },
            }],
          },
          { role: "tool", tool_call_id: "call_1", content: '{"forecast":"sunny"}' },
        ],
        tools: [{
          type: "function",
          function: {
            name: "lookup",
            description: "Lookup data",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
        }],
        tool_choice: { type: "function", function: { name: "lookup" } },
        stream: true,
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
