import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, ProviderRequestError } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAIChat } from "../../src/provider/openai-chat"
import { testEffect } from "../lib/effect"
import { dynamicResponse, fixedResponse, truncatedStream } from "../lib/http"
import { sseEvents } from "../lib/sse"

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

describe("OpenAI Chat adapter", () => {
  it.effect("prepares OpenAI Chat target", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({
        adapters: [OpenAIChat.adapter.withPatches([OpenAIChat.includeUsage])],
      }).prepare(request)

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

  it.effect("adds native query params to the Chat Completions URL", () =>
    Effect.gen(function* () {
      yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
        .generate(LLM.updateRequest(request, { model: LLM.model({ ...model, native: { queryParams: { "api-version": "v1" } } }) }))
        .pipe(
          Effect.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(web.url).toBe("https://api.openai.test/v1/chat/completions?api-version=v1")
                return input.respond(sseEvents(deltaChunk({}, "stop")), { headers: { "content-type": "text/event-stream" } })
              }),
            ),
          ),
        )
    }),
  )

  it.effect("prepares assistant tool-call and tool-result messages", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] }).prepare(
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
      const error = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
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
      const error = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
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
      const body = sseEvents(
        deltaChunk({ role: "assistant", content: "Hello" }),
        deltaChunk({ content: "!" }),
        deltaChunk({}, "stop"),
        usageChunk({
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
          prompt_tokens_details: { cached_tokens: 1 },
          completion_tokens_details: { reasoning_tokens: 0 },
        }),
      )
      const response = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(body)))

      expect(LLM.outputText(response)).toBe("Hello!")
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
    }),
  )

  it.effect("assembles streamed tool call input", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({
          role: "assistant",
          tool_calls: [
            { index: 0, id: "call_1", function: { name: "lookup", arguments: '{"query"' } },
          ],
        }),
        deltaChunk({ tool_calls: [{ index: 0, function: { arguments: ':"weather"}' } }] }),
        deltaChunk({}, "tool_calls"),
      )
      const response = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
        .generate(
          LLM.updateRequest(request, {
            tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
          }),
        )
        .pipe(Effect.provide(fixedResponse(body)))

      expect(response.events).toEqual([
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
        { type: "request-finish", reason: "tool-calls", usage: undefined },
      ])
    }),
  )

  it.effect("does not finalize streamed tool calls without a finish reason", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        deltaChunk({
          role: "assistant",
          tool_calls: [
            { index: 0, id: "call_1", function: { name: "lookup", arguments: '{"query"' } },
          ],
        }),
        deltaChunk({ tool_calls: [{ index: 0, function: { arguments: ':"weather"}' } }] }),
      )
      const response = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
        .generate(
          LLM.updateRequest(request, {
            tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
          }),
        )
        .pipe(Effect.provide(fixedResponse(body)))

      expect(response.events).toEqual([
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' },
      ])
      expect(LLM.outputToolCalls(response)).toEqual([])
    }),
  )

  it.effect("fails on malformed stream chunks", () =>
    Effect.gen(function* () {
      const body = sseEvents(deltaChunk({ content: 123 }))
      const error = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(body)), Effect.flip)

      expect(error.message).toContain("Invalid OpenAI Chat stream chunk")
    }),
  )

  it.effect("surfaces transport errors that occur mid-stream", () =>
    Effect.gen(function* () {
      const layer = truncatedStream([
        `data: ${JSON.stringify(deltaChunk({ role: "assistant", content: "Hello" }))}\n\n`,
      ])
      const error = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
        .generate(request)
        .pipe(Effect.provide(layer), Effect.flip)

      expect(error.message).toContain("Failed to read OpenAI Chat stream")
    }),
  )

  it.effect("fails HTTP provider errors before stream parsing", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.make({ adapters: [OpenAIChat.adapter] })
        .generate(request)
        .pipe(
          Effect.provide(
            fixedResponse('{"error":{"message":"Bad request","type":"invalid_request_error"}}', {
              status: 400,
              headers: { "content-type": "application/json" },
            }),
          ),
          Effect.flip,
        )

      expect(error).toBeInstanceOf(ProviderRequestError)
      expect(error).toMatchObject({ status: 400 })
      expect(error.message).toContain("HTTP 400")
    }),
  )

  it.effect("short-circuits the upstream stream when the consumer takes a prefix", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      // The body has more chunks than we'll consume. If `Stream.take(1)` did
      // not interrupt the upstream HTTP body the test would hang waiting for
      // the rest of the stream to drain.
      const body = sseEvents(
        deltaChunk({ role: "assistant", content: "Hello" }),
        deltaChunk({ content: " world" }),
        deltaChunk({}, "stop"),
      )

      const events = Array.from(
        yield* llm
          .stream(request)
          .pipe(Stream.take(1), Stream.runCollect, Effect.provide(fixedResponse(body))),
      )
      expect(events.map((event) => event.type)).toEqual(["text-delta"])
    }),
  )
})
