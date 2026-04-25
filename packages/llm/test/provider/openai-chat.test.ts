import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
import { OpenAIChat } from "../../src/provider/openai-chat"
import { TransportRequest } from "../../src/schema"
import { Transport } from "../../src/transport"
import { testEffect } from "../lib/effect"

const TargetJson = Schema.fromJsonString(Schema.Unknown)
const encodeJson = Schema.encodeSync(TargetJson)

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  baseURL: "https://api.openai.test/v1/",
  headers: { authorization: "Bearer test" },
})

const request = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

const fixture = (name: string) => Bun.file(new URL(`../fixtures/openai-chat/${name}.sse`, import.meta.url)).text()

const layer = (name: string) =>
  Layer.succeed(
    Transport.Service,
    Transport.Service.of({
      fetch: (request) =>
        Effect.promise(async () =>
          HttpClientResponse.fromWeb(
            HttpClientRequest.post(request.url),
            new Response(await fixture(name), { headers: { "content-type": "text/event-stream" } }),
          ),
        ),
    }),
  )

describe("OpenAI Chat adapter", () => {
  test("prepares OpenAI Chat transport request", async () => {
    const llm = client({ adapter: OpenAIChat.adapter.withPatches([OpenAIChat.includeUsage]) })

    const prepared = await Effect.runPromise(llm.prepare(request))

    expect(prepared.transport).toEqual(
      new TransportRequest({
        url: "https://api.openai.test/v1/chat/completions",
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: encodeJson({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are concise." },
            { role: "user", content: "Say hello." },
          ],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: 20,
          temperature: 0,
        }),
      }),
    )
    expect(prepared.patchTrace.map((item) => item.id)).toEqual(["target.openai-chat.include-usage"])
  })

  testEffect(layer("text")).effect("parses text and usage stream fixtures", () =>
    Effect.gen(function* () {
      const response = yield* client({ adapter: OpenAIChat.adapter }).generate(request)

      expect(response.events).toEqual([
        { type: "text-delta", text: "Hello" },
        { type: "text-delta", text: "!" },
        {
          type: "request-finish",
          reason: "stop",
          usage: {
            inputTokens: 5,
            outputTokens: 2,
            reasoningTokens: 0,
            cacheReadInputTokens: 1,
            totalTokens: 7,
            native: {
              prompt_tokens: 5,
              completion_tokens: 2,
              total_tokens: 7,
              prompt_tokens_details: { cached_tokens: 1 },
              completion_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ])
      expect(response.usage?.totalTokens).toBe(7)
    }),
  )

  testEffect(layer("tool-call")).effect("assembles streamed tool call input", () =>
    Effect.gen(function* () {
      const response = yield* client({ adapter: OpenAIChat.adapter }).generate(
        LLM.request({
          ...request,
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
        }),
      )

      expect(response.events).toEqual([
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
        { type: "request-finish", reason: "tool-calls", usage: undefined },
      ])
    }),
  )
})
