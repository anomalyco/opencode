import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, LLMError } from "../../src"
import { LLMClient } from "../../src/route"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import { it } from "../lib/effect"
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

describe("Anthropic Messages route", () => {
  it.effect("prepares Anthropic Messages target", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(request)

      expect(prepared.body).toEqual({
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
      const prepared = yield* LLMClient.prepare(
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

      expect(prepared.body).toEqual({
        model: "claude-sonnet-4-5",
        messages: [
          { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { query: "weather" } }],
          },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"forecast":"sunny"}' }] },
        ],
        stream: true,
        max_tokens: 4096,
      })
    }),
  )

  it.effect("lowers preserved Anthropic reasoning signature metadata", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model,
          messages: [
            LLM.assistant([
              { type: "reasoning", text: "thinking", providerMetadata: { anthropic: { signature: "sig_1" } } },
            ]),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "thinking", signature: "sig_1" }] }],
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
        { type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "sig_1" } },
        { type: "content_block_stop", index: 1 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: "\n\nHuman:" },
          usage: { output_tokens: 2 },
        },
        { type: "message_stop" },
      )
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      expect(response.text).toBe("Hello!")
      expect(response.reasoning).toBe("thinking")
      expect(response.usage).toMatchObject({
        inputTokens: 5,
        outputTokens: 2,
        cacheReadInputTokens: 1,
        totalTokens: 7,
      })
      expect(response.events.find((event) => event.type === "reasoning-delta" && event.text === "")).toMatchObject({
        providerMetadata: { anthropic: { signature: "sig_1" } },
      })
      expect(response.events.at(-1)).toMatchObject({
        type: "request-finish",
        reason: "stop",
        providerMetadata: { anthropic: { stopSequence: "\n\nHuman:" } },
      })
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
      const response = yield* LLMClient.generate(
        LLM.updateRequest(request, {
          tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      expect(response.toolCalls).toEqual([
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
      ])
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
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(sseEvents({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })),
        ),
      )

      expect(response.events).toEqual([{ type: "provider-error", message: "Overloaded" }])
    }),
  )

  it.effect("fails HTTP provider errors before stream parsing", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse('{"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}', {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        ),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(LLMError)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      expect(error.message).toContain("HTTP 400")
    }),
  )

  it.effect("decodes server_tool_use + web_search_tool_result as provider-executed events", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "server_tool_use", id: "srvtoolu_abc", name: "web_search" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"query":"effect 4"}' },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_abc",
            content: [{ type: "web_search_result", url: "https://example.com", title: "Example" }],
          },
        },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Found it." } },
        { type: "content_block_stop", index: 2 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } },
      )
      const response = yield* LLMClient.generate(
        LLM.updateRequest(request, {
          tools: [{ name: "web_search", description: "Web search", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      const toolCall = response.events.find((event) => event.type === "tool-call")
      expect(toolCall).toEqual({
        type: "tool-call",
        id: "srvtoolu_abc",
        name: "web_search",
        input: { query: "effect 4" },
        providerExecuted: true,
      })
      const toolResult = response.events.find((event) => event.type === "tool-result")
      expect(toolResult).toEqual({
        type: "tool-result",
        id: "srvtoolu_abc",
        name: "web_search",
        result: { type: "json", value: [{ type: "web_search_result", url: "https://example.com", title: "Example" }] },
        providerExecuted: true,
        providerMetadata: { anthropic: { blockType: "web_search_tool_result" } },
      })
      expect(response.text).toBe("Found it.")
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "stop" })
    }),
  )

  it.effect("decodes web_search_tool_result_error as provider-executed error result", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "server_tool_use", id: "srvtoolu_x", name: "web_search" },
        },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"q"}' } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_x",
            content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
          },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      )
      const response = yield* LLMClient.generate(
        LLM.updateRequest(request, {
          tools: [{ name: "web_search", description: "Web search", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(fixedResponse(body)))

      const toolResult = response.events.find((event) => event.type === "tool-result")
      expect(toolResult).toMatchObject({
        type: "tool-result",
        id: "srvtoolu_x",
        name: "web_search",
        result: { type: "error" },
        providerExecuted: true,
      })
    }),
  )

  it.effect("round-trips provider-executed assistant content into server tool blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_round_trip",
          model,
          messages: [
            LLM.user("Search for something."),
            LLM.assistant([
              {
                type: "tool-call",
                id: "srvtoolu_abc",
                name: "web_search",
                input: { query: "effect 4" },
                providerExecuted: true,
              },
              {
                type: "tool-result",
                id: "srvtoolu_abc",
                name: "web_search",
                result: { type: "json", value: [{ url: "https://example.com" }] },
                providerExecuted: true,
              },
              { type: "text", text: "Found it." },
            ]),
            LLM.user("Thanks."),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        messages: [
          { role: "user", content: [{ type: "text", text: "Search for something." }] },
          {
            role: "assistant",
            content: [
              { type: "server_tool_use", id: "srvtoolu_abc", name: "web_search", input: { query: "effect 4" } },
              {
                type: "web_search_tool_result",
                tool_use_id: "srvtoolu_abc",
                content: [{ url: "https://example.com" }],
              },
              { type: "text", text: "Found it." },
            ],
          },
          { role: "user", content: [{ type: "text", text: "Thanks." }] },
        ],
      })
    }),
  )

  it.effect("rejects round-trip for unknown server tool names", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.prepare(
        LLM.request({
          id: "req_unknown_server_tool",
          model,
          messages: [
            LLM.assistant([
              {
                type: "tool-result",
                id: "srvtoolu_abc",
                name: "future_server_tool",
                result: { type: "json", value: {} },
                providerExecuted: true,
              },
            ]),
          ],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("future_server_tool")
    }),
  )

  it.effect("rejects unsupported user media content", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.prepare(
        LLM.request({
          id: "req_media",
          model,
          messages: [LLM.user({ type: "media", mediaType: "image/png", data: "AAECAw==" })],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("Anthropic Messages user messages only support text content for now")
    }),
  )
})
