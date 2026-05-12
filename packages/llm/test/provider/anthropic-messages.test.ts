import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, LLMError, Message, ToolCallPart, Usage } from "../../src"
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
  // This fixture predates the `cache: "auto"` default; pin the policy off so
  // existing wire-shape assertions only see the manual hint on the system part.
  cache: "none",
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
            Message.user("What is the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })]),
            Message.tool({ id: "call_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
          cache: "none",
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
            Message.assistant([
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
        inputTokens: 6,
        outputTokens: 2,
        nonCachedInputTokens: 5,
        cacheReadInputTokens: 1,
        totalTokens: 8,
      })
      expect(response.events.find((event) => event.type === "reasoning-end")).toMatchObject({
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
      const usage = new Usage({
        inputTokens: 5,
        outputTokens: 1,
        nonCachedInputTokens: 5,
        cacheReadInputTokens: undefined,
        cacheWriteInputTokens: undefined,
        totalTokens: 6,
        providerMetadata: { anthropic: { input_tokens: 5, output_tokens: 1 } },
      })

      expect(response.toolCalls).toEqual([
        {
          type: "tool-call",
          id: "call_1",
          name: "lookup",
          input: { query: "weather" },
          providerExecuted: undefined,
          providerMetadata: undefined,
        },
      ])
      expect(response.events).toEqual([
        { type: "step-start", index: 0 },
        { type: "tool-input-start", id: "call_1", name: "lookup" },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' },
        { type: "tool-input-end", id: "call_1", name: "lookup", providerMetadata: undefined },
        {
          type: "tool-call",
          id: "call_1",
          name: "lookup",
          input: { query: "weather" },
          providerExecuted: undefined,
          providerMetadata: undefined,
        },
        { type: "step-finish", index: 0, reason: "tool-calls", usage, providerMetadata: undefined },
        {
          type: "request-finish",
          reason: "tool-calls",
          providerMetadata: undefined,
          usage,
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
            Message.user("Search for something."),
            Message.assistant([
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
            Message.user("Thanks."),
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
            Message.assistant([
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
          messages: [Message.user({ type: "media", mediaType: "image/png", data: "AAECAw==" })],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("Anthropic Messages user messages only support text content for now")
    }),
  )

  it.effect("maps ttlSeconds >= 3600 to cache_control ttl: '1h'", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model,
          system: { type: "text", text: "system", cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }) },
          prompt: "hi",
        }),
      )

      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "system", cache_control: { type: "ephemeral", ttl: "1h" } }],
      })
    }),
  )

  it.effect("emits cache_control on tool definitions and tool-result blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model,
          tools: [
            {
              name: "lookup",
              description: "lookup tool",
              inputSchema: { type: "object", properties: {} },
              cache: new CacheHint({ type: "ephemeral" }),
            },
          ],
          messages: [
            Message.user("What's the weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
            Message.tool({
              id: "call_1",
              name: "lookup",
              result: { temp: 72 },
              cache: new CacheHint({ type: "ephemeral" }),
            }),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "lookup", cache_control: { type: "ephemeral" } }],
        messages: [
          { role: "user", content: [{ type: "text", text: "What's the weather?" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup" }] },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call_1", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("drops cache_control breakpoints past the 4-per-request cap", () =>
    Effect.gen(function* () {
      const hint = new CacheHint({ type: "ephemeral" })
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model,
          system: [
            { type: "text", text: "a", cache: hint },
            { type: "text", text: "b", cache: hint },
            { type: "text", text: "c", cache: hint },
            { type: "text", text: "d", cache: hint },
            { type: "text", text: "e", cache: hint },
            { type: "text", text: "f", cache: hint },
          ],
          prompt: "hi",
        }),
      )

      const system = (prepared.body as { system: Array<{ cache_control?: unknown }> }).system
      const marked = system.filter((part) => part.cache_control !== undefined)
      expect(marked).toHaveLength(4)
      expect(system[4]?.cache_control).toBeUndefined()
      expect(system[5]?.cache_control).toBeUndefined()
    }),
  )

  it.effect("spends breakpoint budget on tools before system before messages", () =>
    Effect.gen(function* () {
      const hint = new CacheHint({ type: "ephemeral" })
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model,
          tools: [
            {
              name: "t1",
              description: "t1",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
            {
              name: "t2",
              description: "t2",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
            {
              name: "t3",
              description: "t3",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
            {
              name: "t4",
              description: "t4",
              inputSchema: { type: "object", properties: {} },
              cache: hint,
            },
          ],
          system: [{ type: "text", text: "system-tail", cache: hint }],
          messages: [Message.user([{ type: "text", text: "message-tail", cache: hint }])],
        }),
      )

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      expect(body.tools.every((t) => t.cache_control !== undefined)).toBe(true)
      expect(body.system[0]?.cache_control).toBeUndefined()
      expect(body.messages[0]?.content[0]?.cache_control).toBeUndefined()
    }),
  )
})
