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
      })
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
        { role: "assistant", content: [{ type: "output_text", text: "After." }] },
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

  it.effect("omits OpenAI-only nullable phases from the Open Responses baseline", () =>
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
        input: [{ role: "assistant", content: [{ type: "output_text", text: "Unclassified." }] }],
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

      expect(response.message.content).toEqual([{ type: "text", text: "I can't help with that." }])

      const prepared = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(prepared.body.input).toEqual([
        { role: "assistant", content: [{ type: "output_text", text: "I can't help with that." }] },
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
