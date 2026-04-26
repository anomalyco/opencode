import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CacheHint, LLM, ProviderRequestError } from "../../src"
import { client } from "../../src/adapter"
import { AnthropicMessages } from "../../src/provider/anthropic-messages"
import { testEffect } from "../lib/effect"
import { fixedResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

const model = AnthropicMessages.model({
  id: "claude-sonnet-4-5",
  baseURL: "https://api.anthropic.test/v1/",
  headers: { "x-api-key": "test" },
})

const request = LLM.request({
  id: "req_1",
  model,
  system: { type: "text", text: "You are concise.", cache: new CacheHint({ type: "ephemeral" }) },
  prompt: "Say hello.",
  generation: { maxTokens: 20, temperature: 0 },
})

const it = testEffect(Layer.empty)

describe("Anthropic Messages adapter", () => {
  it.effect("prepares Anthropic Messages target", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [AnthropicMessages.adapter] }).prepare(request)

      expect(prepared.target).toEqual({
        model: "claude-sonnet-4-5",
        system: [{ type: "text", text: "You are concise.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "Say hello." }] }],
        stream: true,
        max_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("prepares tool call and tool result messages", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [AnthropicMessages.adapter] }).prepare(
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
        model: "claude-sonnet-4-5",
        messages: [
          { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { query: "weather" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"forecast":"sunny"}' }] },
        ],
        stream: true,
        max_tokens: 4096,
      })
    }),
  )

  it.effect("parses text, reasoning, and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "!" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "thinking" } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      )
      const response = yield* client({ adapters: [AnthropicMessages.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(body)))

      expect(LLM.outputText(response)).toBe("Hello!")
      expect(LLM.outputReasoning(response)).toBe("thinking")
      expect(LLM.outputUsage(response)).toMatchObject({
        inputTokens: 5,
        outputTokens: 2,
        cacheReadInputTokens: 1,
        totalTokens: 7,
      })
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )

  it.effect("assembles streamed tool call input", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "lookup" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query"' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"weather"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
      )
      const response = yield* client({ adapters: [AnthropicMessages.adapter] })
        .generate(
          LLM.request({
            ...request,
            tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
          }),
        )
        .pipe(Effect.provide(fixedResponse(body)))

      expect(LLM.outputToolCalls(response)).toEqual([{ type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } }])
      expect(response.events).toEqual([
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
        {
          type: "request-finish",
          reason: "tool-calls",
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6, native: { input_tokens: 5, output_tokens: 1 } },
        },
      ])
    }),
  )

  it.effect("emits provider-error events for mid-stream provider errors", () =>
    Effect.gen(function* () {
      const response = yield* client({ adapters: [AnthropicMessages.adapter] })
        .generate(request)
        .pipe(
          Effect.provide(
            fixedResponse(sseEvents({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })),
          ),
        )

      expect(response.events).toEqual([{ type: "provider-error", message: "Overloaded" }])
    }),
  )

  it.effect("fails HTTP provider errors before stream parsing", () =>
    Effect.gen(function* () {
      const error = yield* client({ adapters: [AnthropicMessages.adapter] })
        .generate(request)
        .pipe(
          Effect.provide(
            fixedResponse('{"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}', {
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

  it.effect("rejects unsupported user media content", () =>
    Effect.gen(function* () {
      const error = yield* client({ adapters: [AnthropicMessages.adapter] })
        .prepare(
          LLM.request({
            id: "req_media",
            model,
            messages: [LLM.user({ type: "media", mediaType: "image/png", data: "AAECAw==" })],
          }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("Anthropic Messages user messages only support text content for now")
    }),
  )
})
