import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, Message, ToolDefinition } from "../../src/index.js"
import { configure } from "../../src/providers/openai-compatible-responses.js"
import { OpenAI } from "../../src/providers.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { OpenAICompatibleResponses } from "../../src/protocols/openai-compatible-responses.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("Open Responses-compatible route", () => {
  it.effect("uses the Open Responses baseline for a configured deployment", () =>
    Effect.gen(function* () {
      expect(OpenAICompatibleResponses.route.body).toBe(OpenResponses.protocol.body)
      expect(OpenAICompatibleResponses.route.transport).toBe(OpenResponses.httpTransport)
      expect(OpenAICompatibleResponses.route.body).not.toBe(OpenAIResponses.protocol.body)

      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          system: "You are concise.",
          prompt: "Say hello.",
        }),
      )

      expect(prepared.route).toBe("openai-compatible-responses")
      expect(prepared.protocol).toBe("open-responses")
      expect(prepared.model).toMatchObject({
        id: "example-model",
        provider: "example",
        route: {
          id: "openai-compatible-responses",
          endpoint: {
            baseURL: "https://responses.example.test/v1",
            path: "/responses",
          },
        },
      })
      expect(prepared.body).toEqual({
        model: "example-model",
        input: [
          { role: "system", content: "You are concise." },
          { role: "user", content: [{ type: "input_text", text: "Say hello." }] },
        ],
        stream: true,
        store: false,
        include: ["reasoning.encrypted_content"],
      })
    }),
  )

  it.effect("allows callers to override stateless encrypted reasoning defaults", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const prepared = yield* compileRequest(
        LLM.request({ model, prompt: "Say hello.", providerOptions: { store: true, include: [] } }),
      )

      expect(prepared.body.store).toBe(true)
      expect(prepared.body.include).toBeUndefined()
    }),
  )

  it.effect("lowers chronological system updates as standard developer messages", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [Message.user("Before."), Message.system("Operator update."), Message.assistant("After.")],
        }),
      )

      expect(prepared.body.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "Before." }] },
        { role: "developer", content: "Operator update." },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "After." }] },
      ])
    }),
  )

  it.effect("uses data URLs for embedded PDF messages and tool results", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const pdf = "data:application/pdf;base64,JVBERi0xLjQ="
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user([{ type: "media", mediaType: "application/pdf", data: pdf, filename: "input.pdf" }]),
            Message.assistant({ type: "tool-call", id: "call_1", name: "read", input: {} }),
            Message.tool({
              id: "call_1",
              name: "read",
              resultType: "content",
              result: [{ type: "file", uri: pdf, mime: "application/pdf", name: "result.pdf" }],
            }),
          ],
        }),
      )

      expect(prepared.body.input).toEqual([
        {
          role: "user",
          content: [{ type: "input_file", filename: "input.pdf", file_data: pdf }],
        },
        { type: "function_call", call_id: "call_1", name: "read", arguments: "{}" },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: [{ type: "input_file", filename: "result.pdf", file_data: pdf }],
        },
      ])
    }),
  )

  it.effect("rejects OpenAI-native tools", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
      }).model("example-model")
      const error = yield* compileRequest(
        LLM.request({ model, prompt: "Draw.", tools: [OpenAI.imageGeneration()] }),
      ).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("Open Responses does not support provider-native tool image_generation")
    }),
  )

  it.effect("lowers canonical parallel tool control", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
      }).model("example-model")
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Read the file.",
          tools: [
            ToolDefinition.make({
              name: "read",
              description: "Read a file.",
              inputSchema: { type: "object" },
            }),
          ],
          toolChoice: { type: "auto", disableParallelToolUse: true },
        }),
      )

      expect(prepared.body.parallel_tool_calls).toBe(false)
      expect(prepared.body.tools).toEqual([
        {
          type: "function",
          name: "read",
          description: "Read a file.",
          parameters: { type: "object" },
          strict: false,
        },
      ])
    }),
  )

  it.effect("keeps foreign item id grammars but drops malformed ids", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
      }).model("example-model")
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant([
              // The baseline does not enforce a provider id grammar, so a
              // non-OpenAI but well-formed token is resent as-is.
              { type: "text", text: "Kept.", providerMetadata: { openresponses: { itemId: "history_1" } } },
              // Shape violations are dropped even without a grammar policy.
              {
                type: "text",
                text: "Dropped.",
                providerMetadata: { openresponses: { itemId: `m${"a".repeat(64)}` } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.input).toEqual([
        {
          type: "message",
          id: "history_1",
          role: "assistant",
          content: [{ type: "output_text", text: "Kept." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Dropped." }],
        },
      ])
    }),
  )

  it.effect("replays only shared hosted tool items", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const items = [
        { type: "web_search_call", id: "ws_1", status: "completed" },
        { type: "x_search_call", id: "x_search_1", status: "completed" },
        { type: "future_call", id: "future_1", status: "completed" },
        { type: "file_search_call", id: "fs_1", queries: "not-an-array" },
      ]
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: items.map((item) =>
            Message.assistant({
              type: "tool-result",
              id: item.id,
              name: item.type,
              result: { type: "json", value: item },
              providerExecuted: true,
              providerMetadata: { openresponses: { itemId: item.id } },
            }),
          ),
        }),
      )

      expect(prepared.body.input).toEqual([
        items[0],
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(items[1]) }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(items[2]) }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(items[3]) }] },
      ])
    }),
  )

  it.effect("routes response deltas by output index", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
      }).model("example-model")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.added", output_index: 2, item: { type: "message", id: "msg_1" } },
              { type: "response.output_text.delta", output_index: 2, item_id: "wrong_message", delta: "Indexed" },
              { type: "response.output_item.done", output_index: 2, item: { type: "message", id: "msg_1" } },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([
        { type: "text", text: "Indexed", providerMetadata: { openresponses: { itemId: "msg_1" } } },
      ])
    }),
  )

  it.effect("streams function calls without optional item ids through the shared baseline", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const item = { type: "function_call", call_id: "call_1", name: "lookup", arguments: "" }
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Look it up." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.added", output_index: 1, item },
              {
                type: "response.function_call_arguments.delta",
                output_index: 1,
                item_id: "opaque_item",
                delta: '{"query":"shared"}',
              },
              {
                type: "response.output_item.done",
                output_index: 1,
                item: { ...item, arguments: '{"query":"complete"}' },
              },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([
        expect.objectContaining({ id: "call_1", name: "lookup", input: { query: "complete" } }),
      ])
      expect(response.events.find(LLMEvent.is.toolCall)?.providerMetadata).toBeUndefined()
    }),
  )

  it.effect("finalizes pending function calls from completed response output", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Look it up." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" },
              },
              { type: "response.function_call_arguments.delta", item_id: "item_1", delta: '{"query":"par' },
              {
                type: "response.completed",
                response: {
                  output: [
                    {
                      type: "function_call",
                      id: "item_1",
                      call_id: "call_1",
                      name: "lookup",
                      arguments: '{"query":"complete"}',
                    },
                  ],
                },
              },
            ),
          ),
        ),
      )

      expect(response.events.find(LLMEvent.is.toolCall)).toMatchObject({
        input: { query: "complete" },
        providerMetadata: { openresponses: { itemId: "item_1" } },
      })
    }),
  )

  it.effect("preserves terminal reasoning metadata when item completion is missing", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
      }).model("example-model")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Think it through." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                item: { type: "reasoning", id: "rs_raw", encrypted_content: null },
              },
              { type: "response.reasoning_summary_text.delta", item_id: "rs_raw", delta: "Thinking" },
              {
                type: "response.completed",
                response: {
                  output: [{ type: "reasoning", id: "rs_raw", encrypted_content: "raw-state" }],
                },
              },
            ),
          ),
        ),
      )

      expect(response.events.find((event) => event.type === "reasoning-end")).toMatchObject({
        providerMetadata: { openresponses: { itemId: "rs_raw", reasoningEncryptedContent: "raw-state" } },
      })
    }),
  )

  it.effect("reconciles raw reasoning finals without streamed deltas", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
      }).model("example-model")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Think it through." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                item: { type: "reasoning", id: "rs_raw", encrypted_content: null },
              },
              // Raw reasoning finals carry no summary index; they reconcile
              // into the item's first block.
              { type: "response.reasoning.done", item_id: "rs_raw", text: "Raw chain of thought." },
              {
                type: "response.output_item.done",
                item: { type: "reasoning", id: "rs_raw", encrypted_content: "raw-state" },
              },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("Raw chain of thought.")
    }),
  )

  it.effect("preserves nullable phases in the forgiving Open Responses baseline", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
      }).model("example-model")
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.assistant({
              type: "text",
              text: "Unclassified.",
              providerMetadata: { openresponses: { phase: null } },
            }),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        input: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Unclassified." }],
            phase: null,
          },
        ],
      })
    }),
  )

  it.effect("preserves standard refusal content as ordinary assistant text", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Unsafe request" })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.added",
                output_index: 0,
                item: { type: "message", id: "msg_refusal", content: [] },
              },
              {
                type: "response.refusal.done",
                item_id: "msg_refusal",
                refusal: "I can't help with that.",
              },
              {
                type: "response.output_item.done",
                output_index: 0,
                item: {
                  type: "message",
                  id: "msg_refusal",
                  content: [{ type: "refusal", refusal: "I can't help with that." }],
                },
              },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.message.content).toEqual([
        {
          type: "text",
          text: "I can't help with that.",
          providerMetadata: { openresponses: { itemId: "msg_refusal" } },
        },
      ])

      const prepared = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(prepared.body.input).toEqual([
        {
          type: "message",
          id: "msg_refusal",
          role: "assistant",
          content: [{ type: "output_text", text: "I can't help with that." }],
        },
      ])
    }),
  )

  it.effect("reads standard Open Responses options", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        providerOptions: {
          reasoningEffort: "low",
          store: true,
          metadata: { environment: "test" },
          safetyIdentifier: "user_123",
          streamOptions: { includeObfuscation: false },
          topLogprobs: 3,
          truncation: "auto",
          serviceTier: "provider-tier",
          allowedTools: { toolNames: ["lookup"] },
          maxToolCalls: 2,
          parallelToolCalls: false,
        },
      }).model("example-model")
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Think.",
          generation: { presencePenalty: 0.2, frequencyPenalty: -0.1 },
          tools: [ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })],
        }),
      )

      expect(prepared.body).toMatchObject({
        reasoning: { effort: "low" },
        store: true,
        metadata: { environment: "test" },
        safety_identifier: "user_123",
        stream_options: { include_obfuscation: false },
        top_logprobs: 3,
        presence_penalty: 0.2,
        frequency_penalty: -0.1,
        truncation: "auto",
        service_tier: "provider-tier",
        tool_choice: {
          type: "allowed_tools",
          mode: "auto",
          tools: [{ type: "function", name: "lookup" }],
        },
        max_tool_calls: 2,
        parallel_tool_calls: false,
      })
    }),
  )

  it.effect("does not interpret OpenAI hosted-tool items", () =>
    Effect.gen(function* () {
      const model = configure({
        apiKey: "test-key",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
      }).model("example-model")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Search." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              {
                type: "response.output_item.done",
                item: { type: "web_search_call", id: "ws_1", status: "completed", action: { query: "news" } },
              },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      expect(response.toolCalls).toEqual([])
      expect(response.events.find(LLMEvent.is.finish)).toMatchObject({
        providerMetadata: { openresponses: { responseId: "resp_1" } },
      })
    }),
  )
})
