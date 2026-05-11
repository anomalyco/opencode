import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, Message, ToolCallPart } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenAICompatible from "../../src/providers/openai-compatible"
import * as OpenAICompatibleChat from "../../src/protocols/openai-compatible-chat"
import { it } from "../lib/effect"
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
  ["baseten", OpenAICompatible.baseten, "https://inference.baseten.co/v1"],
  ["cerebras", OpenAICompatible.cerebras, "https://api.cerebras.ai/v1"],
  ["deepinfra", OpenAICompatible.deepinfra, "https://api.deepinfra.com/v1/openai"],
  ["deepseek", OpenAICompatible.deepseek, "https://api.deepseek.com/v1"],
  ["fireworks", OpenAICompatible.fireworks, "https://api.fireworks.ai/inference/v1"],
  ["togetherai", OpenAICompatible.togetherai, "https://api.together.xyz/v1"],
] as const

describe("OpenAI-compatible Chat route", () => {
  it.effect("prepares generic Chat target", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.updateRequest(request, {
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
          toolChoice: { type: "required" },
        }),
      )

      expect(prepared.route).toBe("openai-compatible-chat")
      expect(prepared.model).toMatchObject({
        id: "deepseek-chat",
        provider: "deepseek",
        route: "openai-compatible-chat",
        baseURL: "https://api.deepseek.test/v1/",
        apiKey: "test-key",
        queryParams: { "api-version": "2026-01-01" },
      })
      expect(prepared.body).toEqual({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        tools: [
          {
            type: "function",
            function: { name: "lookup", description: "Lookup data", parameters: { type: "object" } },
          },
        ],
        tool_choice: "required",
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("provides model helpers for compatible provider families", () =>
    Effect.gen(function* () {
      expect(
        providerFamilies.map(([provider, family]) => {
          const model = family.model(`${provider}-model`, { apiKey: "test-key" })
          return {
            id: String(model.id),
            provider: String(model.provider),
            route: model.route,
            baseURL: model.baseURL,
            apiKey: model.apiKey,
          }
        }),
      ).toEqual(
        providerFamilies.map(([provider, _, baseURL]) => ({
          id: `${provider}-model`,
          provider,
          route: "openai-compatible-chat",
          baseURL,
          apiKey: "test-key",
        })),
      )

      const custom = OpenAICompatible.deepseek.model("deepseek-chat", {
        apiKey: "test-key",
        baseURL: "https://custom.deepseek.test/v1",
      })
      expect(custom).toMatchObject({
        provider: "deepseek",
        route: "openai-compatible-chat",
        baseURL: "https://custom.deepseek.test/v1",
      })
    }),
  )

  it.effect("matches AI SDK compatible basic request body fixture", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(request)

      expect(prepared.body).toEqual({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("matches AI SDK compatible tool request body fixture", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_tool_parity",
          model,
          tools: [
            {
              name: "lookup",
              description: "Lookup data",
              inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
            },
          ],
          toolChoice: "lookup",
          messages: [
            Message.user("What is the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.body).toEqual({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: "What is the weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"query":"weather"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: '{"forecast":"sunny"}' },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              description: "Lookup data",
              parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "lookup" } },
        stream: true,
        stream_options: { include_usage: true },
      })
    }),
  )

  it.effect("posts to the configured compatible endpoint and parses text usage", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://api.deepseek.test/v1/chat/completions?api-version=2026-01-01")
              expect(web.headers.get("authorization")).toBe("Bearer test-key")
              expect(decodeJson(input.text)).toMatchObject({
                model: "deepseek-chat",
                stream: true,
                messages: [
                  { role: "system", content: "You are concise." },
                  { role: "user", content: "Say hello." },
                ],
              })
              return input.respond(
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

      expect(response.text).toBe("Hello!")
      expect(response.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, totalTokens: 7 })
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )
})
