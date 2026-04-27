import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { LLM, LLMEvent } from "../src"
import { LLMClient } from "../src/adapter"
import { RequestExecutor } from "../src/executor"
import { OpenAIChat } from "../src/provider/openai-chat"
import { tool, ToolFailure } from "../src/tool"
import { ToolRuntime } from "../src/tool-runtime"
import { testEffect } from "./lib/effect"
import { scriptedResponses } from "./lib/http"
import { deltaChunk, finishChunk, toolCallChunk } from "./lib/openai-chunks"
import { sseEvents } from "./lib/sse"

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  baseURL: "https://api.openai.test/v1/",
  headers: { authorization: "Bearer test" },
})

const baseRequest = LLM.request({
  id: "req_1",
  model,
  prompt: "Use the tool.",
})

const it = testEffect(Layer.empty)

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

describe("ToolRuntime", () => {
  it.effect("dispatches a tool call, appends results, and resumes streaming", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "It's sunny in Paris." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, { request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const result = events.find(LLMEvent.guards["tool-result"])
      expect(result).toMatchObject({
        type: "tool-result",
        id: "call_1",
        name: "get_weather",
        result: { type: "json", value: { temperature: 22, condition: "sunny" } },
      })
      expect(events.at(-1)?.type).toBe("request-finish")
      expect(LLM.outputText({ events })).toBe("It's sunny in Paris.")
    }),
  )

  it.effect("emits tool-error for unknown tools so the model can self-correct", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "missing_tool", "{}"), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Sorry." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, { request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const toolError = events.find(LLMEvent.guards["tool-error"])
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "missing_tool" })
      expect(toolError?.message).toContain("Unknown tool")
      expect(events.find(LLMEvent.guards["tool-result"])).toMatchObject({
        type: "tool-result",
        id: "call_1",
        name: "missing_tool",
        result: { type: "error", value: "Unknown tool: missing_tool" },
      })
    }),
  )

  it.effect("emits tool-error when the LLM input fails the parameters schema", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":42}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, { request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const toolError = events.find(LLMEvent.guards["tool-error"])
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "get_weather" })
      expect(toolError?.message).toContain("Invalid tool input")
    }),
  )

  it.effect("emits tool-error when the handler returns a ToolFailure", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"FAIL"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Sorry." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, { request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const toolError = events.find(LLMEvent.guards["tool-error"])
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "get_weather" })
      expect(toolError?.message).toBe("Weather lookup failed for FAIL")
    }),
  )

  it.effect("stops when the model finishes without requesting more tools", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop"))])

      const events = Array.from(
        yield* ToolRuntime.run(llm, { request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
      expect(LLM.outputText({ events })).toBe("Done.")
    }),
  )

  it.effect("respects maxSteps and stops the loop", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      // Every script entry asks for another tool call. With maxSteps: 2 the
      // runtime should run at most two model rounds and then exit even though
      // the model still wants to keep going.
      const toolCallStep = sseEvents(toolCallChunk("call_x", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls"))
      const layer = scriptedResponses([toolCallStep, toolCallStep, toolCallStep])

      const events = Array.from(
        yield* ToolRuntime.run(llm, { request: baseRequest, tools: { get_weather }, maxSteps: 2 }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      expect(events.filter(LLMEvent.guards["request-finish"])).toHaveLength(2)
    }),
  )

  it.effect("stops when stopWhen returns true after the first step", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'), finishChunk("tool_calls")),
        sseEvents(deltaChunk({ role: "assistant", content: "Should not run." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
          stopWhen: (state) => state.step >= 0,
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      expect(events.filter(LLMEvent.guards["request-finish"])).toHaveLength(1)
      expect(events.find(LLMEvent.guards["tool-result"])).toBeUndefined()
    }),
  )

  it.effect("does not dispatch provider-executed tool calls", () =>
    Effect.gen(function* () {
      // Stub client emits a provider-executed tool-call followed by its
      // tool-result and a stop. The runtime must not dispatch a handler (no
      // tool-error for unknown name) and must not loop (no second stream).
      let streams = 0
      const stub: LLMClient = {
        prepare: () => Effect.die("not used"),
        generate: () => Effect.die("not used"),
        stream: () => {
          streams++
          return Stream.fromIterable<LLMEvent>([
            { type: "request-start", id: "req_1", model: baseRequest.model },
            {
              type: "tool-call",
              id: "srvtoolu_abc",
              name: "web_search",
              input: { query: "x" },
              providerExecuted: true,
            },
            {
              type: "tool-result",
              id: "srvtoolu_abc",
              name: "web_search",
              result: { type: "json", value: { results: [] } },
              providerExecuted: true,
            },
            { type: "text-delta", text: "Done." },
            { type: "request-finish", reason: "stop" },
          ])
        },
      }

      // The runtime's stream type carries `RequestExecutor.Service` because
      // adapters use it. Our stub never executes HTTP, but the type still
      // demands the service — provide a noop so the test compiles.
      const noopExecutor = Layer.succeed(RequestExecutor.Service, {
        execute: () => Effect.die("stub client never executes HTTP"),
      })
      const events = Array.from(
        yield* ToolRuntime.run(stub, { request: baseRequest, tools: {} }).pipe(
          Stream.runCollect,
          Effect.provide(noopExecutor),
        ),
      )

      expect(streams).toBe(1)
      expect(events.find(LLMEvent.guards["tool-error"])).toBeUndefined()
      expect(events.filter(LLMEvent.guards["tool-call"])).toEqual([
        {
          type: "tool-call",
          id: "srvtoolu_abc",
          name: "web_search",
          input: { query: "x" },
          providerExecuted: true,
        },
      ])
      expect(LLM.outputText({ events })).toBe("Done.")
    }),
  )

  it.effect("dispatches multiple tool calls in one step concurrently", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [OpenAIChat.adapter] })
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
        yield* ToolRuntime.run(llm, { request: baseRequest, tools: { get_weather } }).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )

      const results = events.filter(LLMEvent.guards["tool-result"])
      expect(results).toHaveLength(2)
      expect(results.map((event) => event.id).toSorted()).toEqual(["c1", "c2"])
    }),
  )
})
