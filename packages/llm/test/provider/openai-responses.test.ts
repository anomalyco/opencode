import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, ProviderRequestError } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAIResponses } from "../../src/provider/openai-responses"
import { testEffect } from "../lib/effect"
import { dynamicResponse, fixedResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

const model = OpenAIResponses.model({
  id: "gpt-4.1-mini",
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

describe("OpenAI Responses adapter", () => {
  it.effect("prepares OpenAI Responses target", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] }).prepare(request)

      expect(prepared.target).toEqual({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: "You are concise." },
          { role: "user", content: [{ type: "input_text", text: "Say hello." }] },
        ],
        stream: true,
        max_output_tokens: 20,
        temperature: 0,
      })
    }),
  )

  it.effect("adds native query params to the Responses URL", () =>
    Effect.gen(function* () {
      yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .generate(LLM.updateRequest(request, { model: LLM.model({ ...model, native: { queryParams: { "api-version": "v1" } } }) }))
        .pipe(
          Effect.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(web.url).toBe("https://api.openai.test/v1/responses?api-version=v1")
                return input.respond(sseEvents({ type: "response.completed", response: {} }), {
                  headers: { "content-type": "text/event-stream" },
                })
              }),
            ),
          ),
        )
    }),
  )

  it.effect("prepares function call and function output input items", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] }).prepare(
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
        model: "gpt-4.1-mini",
        input: [
          { role: "user", content: [{ type: "input_text", text: "What is the weather?" }] },
          { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"query":"weather"}' },
          { type: "function_call_output", call_id: "call_1", output: '{"forecast":"sunny"}' },
        ],
        stream: true,
      })
    }),
  )

  it.effect("parses text and usage stream fixtures", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Hello" },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "!" },
        {
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 5,
              output_tokens: 2,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 1 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      )
      const response = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(body)))

      expect(LLM.outputText(response)).toBe("Hello!")
      expect(response.events).toEqual([
        { type: "text-delta", id: "msg_1", text: "Hello" },
        { type: "text-delta", id: "msg_1", text: "!" },
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
              input_tokens: 5,
              output_tokens: 2,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 1 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ])
    }),
  )

  it.effect("assembles streamed function call input", () =>
    Effect.gen(function* () {
      const body = sseEvents(
        {
          type: "response.output_item.added",
          item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" },
        },
        { type: "response.function_call_arguments.delta", item_id: "item_1", delta: '{"query"' },
        { type: "response.function_call_arguments.delta", item_id: "item_1", delta: ':"weather"}' },
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "item_1",
            call_id: "call_1",
            name: "lookup",
            arguments: '{"query":"weather"}',
          },
        },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
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
        {
          type: "request-finish",
          reason: "stop",
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6, native: { input_tokens: 5, output_tokens: 1 } },
        },
      ])
    }),
  )

  it.effect("decodes web_search_call as provider-executed tool-call + tool-result", () =>
    Effect.gen(function* () {
      const item = {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "effect 4" },
      }
      const body = sseEvents(
        { type: "response.output_item.added", item },
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(body)))

      const callsAndResults = response.events.filter((event) => event.type === "tool-call" || event.type === "tool-result")
      expect(callsAndResults).toEqual([
        {
          type: "tool-call",
          id: "ws_1",
          name: "web_search",
          input: { type: "search", query: "effect 4" },
          providerExecuted: true,
        },
        {
          type: "tool-result",
          id: "ws_1",
          name: "web_search",
          result: { type: "json", value: item },
          providerExecuted: true,
        },
      ])
    }),
  )

  it.effect("decodes code_interpreter_call as provider-executed events with code input", () =>
    Effect.gen(function* () {
      const item = {
        type: "code_interpreter_call",
        id: "ci_1",
        status: "completed",
        code: "print(1+1)",
        container_id: "cnt_xyz",
        outputs: [{ type: "logs", logs: "2\n" }],
      }
      const body = sseEvents(
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } },
      )
      const response = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(body)))

      const toolCall = response.events.find((event) => event.type === "tool-call")
      expect(toolCall).toEqual({
        type: "tool-call",
        id: "ci_1",
        name: "code_interpreter",
        input: { code: "print(1+1)", container_id: "cnt_xyz" },
        providerExecuted: true,
      })
      const toolResult = response.events.find((event) => event.type === "tool-result")
      expect(toolResult).toEqual({
        type: "tool-result",
        id: "ci_1",
        name: "code_interpreter",
        result: { type: "json", value: item },
        providerExecuted: true,
      })
    }),
  )

  it.effect("rejects unsupported user media content", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .prepare(
          LLM.request({
            id: "req_media",
            model,
            messages: [LLM.user({ type: "media", mediaType: "image/png", data: "AAECAw==" })],
          }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("OpenAI Responses user messages only support text content for now")
    }),
  )

  it.effect("emits provider-error events for mid-stream provider errors", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .generate(request)
        .pipe(
          Effect.provide(
            fixedResponse(sseEvents({ type: "error", code: "rate_limit_exceeded", message: "Slow down" })),
          ),
        )

      expect(response.events).toEqual([{ type: "provider-error", message: "Slow down" }])
    }),
  )

  it.effect("falls back to error code when no message is present", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .generate(request)
        .pipe(Effect.provide(fixedResponse(sseEvents({ type: "error", code: "internal_error" }))))

      expect(response.events).toEqual([{ type: "provider-error", message: "internal_error" }])
    }),
  )

  it.effect("fails HTTP provider errors before stream parsing", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] })
        .generate(request)
        .pipe(
          Effect.provide(
            fixedResponse('{"error":{"type":"invalid_request_error","message":"Bad request"}}', {
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
})
