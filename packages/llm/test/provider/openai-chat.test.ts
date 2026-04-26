import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
import { RequestExecutor } from "../../src/executor"
import { OpenAIChat } from "../../src/provider/openai-chat"
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

const it = testEffect(Layer.empty)

const streamLayer = (body: string) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(body, { headers: { "content-type": "text/event-stream" } }),
            ),
          ),
        ),
      ),
    ),
  )

describe("OpenAI Chat adapter", () => {
  it.effect("prepares OpenAI Chat target", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [OpenAIChat.adapter.withPatches([OpenAIChat.includeUsage])] }).prepare(request)

      expect(prepared.target).toEqual({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Say hello." },
        ],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 20,
        temperature: 0,
      })
      expect(prepared.patchTrace.map((item) => item.id)).toEqual(["target.openai-chat.include-usage"])
    }),
  )

  it.effect("prepares assistant tool-call and tool-result messages", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [OpenAIChat.adapter] }).prepare(
        LLM.request({
          id: "req_tool_result",
          model,
          messages: [
            LLM.user("What is the weather?"),
            LLM.assistant([LLM.toolCall({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            LLM.toolMessage({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.target).toEqual({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: "What is the weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: encodeJson({ query: "weather" }) },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: encodeJson({ forecast: "sunny" }) },
        ],
        stream: true,
      })
    }),
  )

  it.effect("rejects unsupported user media content", () =>
    Effect.gen(function* () {
      const error = yield* client({ adapters: [OpenAIChat.adapter] })
        .prepare(
          LLM.request({
            id: "req_media",
            model,
            messages: [LLM.user({ type: "media", mediaType: "image/png", data: "AAECAw==" })],
          }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("OpenAI Chat user messages only support text content for now")
    }),
  )

  it.effect("rejects unsupported assistant reasoning content", () =>
    Effect.gen(function* () {
      const error = yield* client({ adapters: [OpenAIChat.adapter] })
        .prepare(
          LLM.request({
            id: "req_reasoning",
            model,
            messages: [LLM.assistant({ type: "reasoning", text: "hidden" })],
          }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("OpenAI Chat assistant messages only support text and tool-call content for now")
    }),
  )

  it.effect("parses text and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = `data: {"id":"chatcmpl_fixture","choices":[{"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl_fixture","choices":[{"delta":{"content":"!"},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl_fixture","choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}

data: {"id":"chatcmpl_fixture","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":0}}}

data: [DONE]
`
      const response = yield* client({ adapters: [OpenAIChat.adapter] }).generate(request).pipe(Effect.provide(streamLayer(body)))

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

  it.effect("assembles streamed tool call input", () =>
    Effect.gen(function* () {
      const body = `data: {"id":"chatcmpl_fixture","choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\\"query\\""}}]},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl_fixture","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"weather\\"}"}}]},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl_fixture","choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":null}

data: [DONE]
`
      const response = yield* client({ adapters: [OpenAIChat.adapter] }).generate(
        LLM.request({
          ...request,
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(streamLayer(body)))

      expect(response.events).toEqual([
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
        { type: "request-finish", reason: "tool-calls", usage: undefined },
      ])
    }),
  )

  it.effect("fails on malformed stream chunks", () =>
    Effect.gen(function* () {
      const body = `data: {"id":"chatcmpl_fixture","choices":[{"delta":{"content":123},"finish_reason":null}],"usage":null}

data: [DONE]
`
      const error = yield* client({ adapters: [OpenAIChat.adapter] })
        .generate(request)
        .pipe(Effect.provide(streamLayer(body)), Effect.flip)

      expect(error.message).toContain("Invalid OpenAI Chat stream chunk")
    }),
  )
})
