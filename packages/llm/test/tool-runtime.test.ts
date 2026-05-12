import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { GenerationOptions, LLM, LLMEvent, LLMRequest, LLMResponse, ToolChoice } from "../src"
import { LLMClient } from "../src/route"
import * as AnthropicMessages from "../src/protocols/anthropic-messages"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { tool, ToolFailure } from "../src/tool"
import { it } from "./lib/effect"
import * as TestToolRuntime from "./lib/tool-runtime"
import { dynamicResponse, scriptedResponses } from "./lib/http"
import { deltaChunk, finishChunk, toolCallChunk } from "./lib/openai-chunks"
import { sseEvents } from "./lib/sse"

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  baseURL: "https://api.openai.test/v1/",
  headers: { authorization: "Bearer test" },
})
const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)

const baseRequest = LLM.request({
  id: "req_1",
  model,
  prompt: "Use the tool.",
})

const get_weather = tool({
  description: "Get current weather for a city.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ temperature: Schema.Number, condition: Schema.String }),
  execute: ({ city }) =>
    Effect.gen(function* () {
      if (city === "FAIL") return yield* new ToolFailure({ message: `Weather lookup failed for ${city}` })
      return { temperature: 22, condition: "sunny" }
    }),
})

const schema_only_weather = tool({
  description: "Get current weather for a city.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ temperature: Schema.Number, condition: Schema.String }),
})

describe("LLMClient tools", () => {
  it.effect("uses the registered model route when adding runtime tools", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      expect(LLMResponse.text({ events })).toBe("Done.")
    }),
  )

  it.effect("sends tool-call history and request options on the follow-up request", () =>
    Effect.gen(function* () {
      const bodies: unknown[] = []
      const responses = [
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "It's sunny in Paris." }), finishChunk("stop")),
      ]
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(decodeJson(input.text))
          return input.respond(responses[bodies.length - 1] ?? responses[responses.length - 1], {
            headers: { "content-type": "text/event-stream" },
          })
        }),
      )

      yield* TestToolRuntime.runTools({
        request: LLMRequest.update(baseRequest, {
          generation: GenerationOptions.make({ maxTokens: 50 }),
          toolChoice: ToolChoice.make("auto"),
        }),
        tools: { get_weather },
      }).pipe(Stream.runCollect, Effect.provide(layer))

      const second = bodies[1] as {
        readonly messages?: ReadonlyArray<Record<string, unknown>>
        readonly tools?: ReadonlyArray<unknown>
        readonly tool_choice?: unknown
        readonly max_tokens?: unknown
      }

      expect(second.max_tokens).toBe(50)
      expect(second.tool_choice).toBe("auto")
      expect(second.tools).toHaveLength(1)
      expect(second.messages?.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
      expect(second.messages?.[1]).toMatchObject({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather" } }],
      })
      expect(second.messages?.[2]).toMatchObject({
        role: "tool",
        tool_call_id: "call_1",
        content: '{"temperature":22,"condition":"sunny"}',
      })
    }),
  )

  it.effect("dispatches a tool call, appends results, and resumes streaming", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "It's sunny in Paris." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const result = events.find(LLMEvent.is.toolResult)
      expect(result).toMatchObject({
        type: "tool-result",
        id: "call_1",
        name: "get_weather",
        result: { type: "json", value: { temperature: 22, condition: "sunny" } },
      })
      expect(events.at(-1)?.type).toBe("request-finish")
      expect(LLMResponse.text({ events })).toBe("It's sunny in Paris.")
    }),
  )

  it.effect("executes tool calls for one step without looping by default", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Should not run." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* LLMClient.stream({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      expect(events.filter(LLMEvent.is.requestFinish)).toHaveLength(1)
      expect(events.find(LLMEvent.is.toolResult)).toMatchObject({ type: "tool-result", id: "call_1" })
    }),
  )

  it.effect("can expose tool schemas without executing tool calls", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls")),
      ])

      const events = Array.from(
        yield* LLMClient.stream({
          request: baseRequest,
          tools: { get_weather: schema_only_weather },
          toolExecution: "none",
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      expect(events.find(LLMEvent.is.toolCall)).toMatchObject({ type: "tool-call", id: "call_1" })
      expect(events.find(LLMEvent.is.toolResult)).toBeUndefined()
    }),
  )

  it.effect("preserves provider metadata when folding streamed assistant content into follow-up history", () =>
    Effect.gen(function* () {
      const bodies: unknown[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(decodeJson(input.text))
          return input.respond(
            bodies.length === 1
              ? sseEvents(
                  { type: "message_start", message: { usage: { input_tokens: 5 } } },
                  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
                  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "thinking" } },
                  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_1" } },
                  { type: "content_block_stop", index: 0 },
                  {
                    type: "content_block_start",
                    index: 1,
                    content_block: { type: "tool_use", id: "call_1", name: "get_weather" },
                  },
                  {
                    type: "content_block_delta",
                    index: 1,
                    delta: { type: "input_json_delta", partial_json: '{"city":"Paris"}' },
                  },
                  { type: "content_block_stop", index: 1 },
                  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
                )
              : sseEvents(
                  { type: "message_start", message: { usage: { input_tokens: 5 } } },
                  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
                  { type: "content_block_stop", index: 0 },
                  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
                ),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )

      yield* TestToolRuntime.runTools({
        request: LLM.updateRequest(baseRequest, {
          model: AnthropicMessages.model({ id: "claude-sonnet-4-5", apiKey: "test" }),
        }),
        tools: { get_weather },
      }).pipe(Stream.runCollect, Effect.provide(layer))

      expect(bodies[1]).toMatchObject({
        messages: [
          { role: "user" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "thinking", signature: "sig_1" },
              { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } },
            ],
          },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1" }] },
        ],
      })
    }),
  )

  it.effect("emits tool-error for unknown tools so the model can self-correct", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "missing_tool", "{}"), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Sorry." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const toolError = events.find(LLMEvent.is.toolError)
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "missing_tool" })
      expect(toolError?.message).toContain("Unknown tool")
      expect(events.find(LLMEvent.is.toolResult)).toMatchObject({
        type: "tool-result",
        id: "call_1",
        name: "missing_tool",
        result: { type: "error", value: "Unknown tool: missing_tool" },
      })
    }),
  )

  it.effect("emits tool-error when the LLM input fails the parameters schema", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":42}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const toolError = events.find(LLMEvent.is.toolError)
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "get_weather" })
      expect(toolError?.message).toContain("Invalid tool input")
    }),
  )

  it.effect("emits tool-error when the handler returns a ToolFailure", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"FAIL"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Sorry." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const toolError = events.find(LLMEvent.is.toolError)
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "get_weather" })
      expect(toolError?.message).toBe("Weather lookup failed for FAIL")
    }),
  )

  it.effect("stops when the model finishes without requesting more tools", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      expect(events.map((event) => event.type)).toEqual([
        "step-start",
        "text-start",
        "text-delta",
        "text-end",
        "step-finish",
        "request-finish",
      ])
      expect(LLMResponse.text({ events })).toBe("Done.")
    }),
  )

  it.effect("respects maxSteps and stops the loop", () =>
    Effect.gen(function* () {
      // Every script entry asks for another tool call. With maxSteps: 2 the
      // runtime should run at most two model rounds and then exit even though
      // the model still wants to keep going.
      const toolCallStep = sseEvents(
        toolCallChunk("call_x", "get_weather", '{"city":"Paris"}'),
        finishChunk("tool_calls"),
      )
      const layer = scriptedResponses([toolCallStep, toolCallStep, toolCallStep])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather }, maxSteps: 2 }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      expect(events.filter(LLMEvent.is.requestFinish)).toHaveLength(2)
    }),
  )

  it.effect("stops follow-up when stopWhen returns true after the first step", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Should not run." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({
          request: baseRequest,
          tools: { get_weather },
          stopWhen: (state) => state.step >= 0,
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      expect(events.filter(LLMEvent.is.requestFinish)).toHaveLength(1)
      expect(events.find(LLMEvent.is.toolResult)).toMatchObject({ type: "tool-result", id: "call_1" })
    }),
  )

  it.effect("does not dispatch provider-executed tool calls", () =>
    Effect.gen(function* () {
      let streams = 0
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          streams++
          return input.respond(
            sseEvents(
              { type: "message_start", message: { usage: { input_tokens: 5 } } },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "server_tool_use", id: "srvtoolu_abc", name: "web_search" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "input_json_delta", partial_json: '{"query":"x"}' },
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
              { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Done." } },
              { type: "content_block_stop", index: 2 },
              { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } },
            ),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )
      const events = Array.from(
        yield* TestToolRuntime.runTools({
          request: LLM.updateRequest(baseRequest, {
            model: AnthropicMessages.model({ id: "claude-sonnet-4-5", apiKey: "test" }),
          }),
          tools: {},
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      expect(streams).toBe(1)
      expect(events.find(LLMEvent.is.toolError)).toBeUndefined()
      expect(events.filter(LLMEvent.is.toolCall)).toEqual([
        {
          type: "tool-call",
          id: "srvtoolu_abc",
          name: "web_search",
          input: { query: "x" },
          providerExecuted: true,
        },
      ])
      expect(LLMResponse.text({ events })).toBe("Done.")
    }),
  )

  it.effect("dispatches multiple tool calls in one step concurrently", () =>
    Effect.gen(function* () {
      const layer = scriptedResponses([
        sseEvents(
          deltaChunk({
            role: "assistant",
            tool_calls: [
              { index: 0, id: "c1", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
              { index: 1, id: "c2", function: { name: "get_weather", arguments: '{"city":"Tokyo"}' } },
            ],
          }),
          finishChunk("tool_calls"),
        ),
        sseEvents(deltaChunk({ role: "assistant", content: "Both done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* TestToolRuntime.runTools({ request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const results = events.filter(LLMEvent.is.toolResult)
      expect(results).toHaveLength(2)
      expect(results.map((event) => event.id).toSorted()).toEqual(["c1", "c2"])
    }),
  )
})
