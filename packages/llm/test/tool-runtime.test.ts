import { describe, expect } from "bun:test"
import { Effect, Layer, Ref, Schema, Stream } from "effect"
import { LLM } from "../src"
import { client } from "../src/adapter"
import { OpenAIChat } from "../src/provider/openai-chat"
import { tool, ToolFailure } from "../src/tool"
import { ToolRuntime } from "../src/tool-runtime"
import { testEffect } from "./lib/effect"
import { dynamicResponse } from "./lib/http"
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

const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_x",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

const toolCallChunk = (id: string, name: string, args: string) =>
  deltaChunk({
    role: "assistant",
    tool_calls: [{ index: 0, id, function: { name, arguments: args } }],
  })

const finishChunk = (reason: string) => deltaChunk({}, reason)

/**
 * Builds an HTTP layer where successive requests return successive bodies.
 * Used to script multi-step model exchanges.
 */
const scriptedResponses = (bodies: ReadonlyArray<string>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const cursor = yield* Ref.make(0)
      return dynamicResponse(() =>
        Effect.gen(function* () {
          const index = yield* Ref.getAndUpdate(cursor, (n) => n + 1)
          const body = bodies[index] ?? bodies.at(-1)!
          return new Response(body, { headers: { "content-type": "text/event-stream" } })
        }),
      )
    }),
  )

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
      const llm = client({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(
          toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'),
          finishChunk("tool_calls"),
        ),
        sseEvents(
          deltaChunk({ role: "assistant", content: "It's sunny in Paris." }),
          finishChunk("stop"),
        ),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      const types = events.map((event) => event.type)
      expect(types).toContain("tool-call")
      expect(types).toContain("tool-result")
      expect(events.find((event) => event.type === "tool-result")).toMatchObject({
        type: "tool-result",
        id: "call_1",
        name: "get_weather",
        result: { type: "json", value: { temperature: 22, condition: "sunny" } },
      })
      expect(types.at(-1)).toBe("request-finish")
      expect(LLM.outputText({ events })).toBe("It's sunny in Paris.")
    }),
  )

  it.effect("emits tool-error for unknown tools so the model can self-correct", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(
          toolCallChunk("call_1", "missing_tool", "{}"),
          finishChunk("tool_calls"),
        ),
        sseEvents(deltaChunk({ role: "assistant", content: "Sorry." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      const toolError = events.find((event) => event.type === "tool-error")
      expect(toolError).toMatchObject({
        type: "tool-error",
        id: "call_1",
        name: "missing_tool",
      })
      expect((toolError as { message: string }).message).toContain("Unknown tool")
    }),
  )

  it.effect("emits tool-error when the LLM input fails the parameters schema", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(
          toolCallChunk("call_1", "get_weather", '{"city":42}'),
          finishChunk("tool_calls"),
        ),
        sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      const toolError = events.find((event) => event.type === "tool-error")
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "get_weather" })
      expect((toolError as { message: string }).message).toContain("Invalid tool input")
    }),
  )

  it.effect("emits tool-error when the handler returns a ToolFailure", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(
          toolCallChunk("call_1", "get_weather", '{"city":"FAIL"}'),
          finishChunk("tool_calls"),
        ),
        sseEvents(deltaChunk({ role: "assistant", content: "Sorry." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      const toolError = events.find((event) => event.type === "tool-error")
      expect(toolError).toMatchObject({ type: "tool-error", id: "call_1", name: "get_weather" })
      expect((toolError as { message: string }).message).toBe("Weather lookup failed for FAIL")
    }),
  )

  it.effect("stops when the model finishes without requesting more tools", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
      expect(LLM.outputText({ events })).toBe("Done.")
    }),
  )

  it.effect("respects maxSteps and stops the loop", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [OpenAIChat.adapter] })
      // Every script entry asks for another tool call. With maxSteps: 2 the
      // runtime should run at most two model rounds and then exit even though
      // the model still wants to keep going.
      const toolCallStep = sseEvents(
        toolCallChunk("call_x", "get_weather", '{"city":"Paris"}'),
        finishChunk("tool_calls"),
      )
      const layer = scriptedResponses([toolCallStep, toolCallStep, toolCallStep])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
          maxSteps: 2,
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      const finishEvents = events.filter((event) => event.type === "request-finish")
      expect(finishEvents).toHaveLength(2)
    }),
  )

  it.effect("stops when stopWhen returns true after the first step", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [OpenAIChat.adapter] })
      const layer = scriptedResponses([
        sseEvents(
          toolCallChunk("call_1", "get_weather", '{"city":"Paris"}'),
          finishChunk("tool_calls"),
        ),
        sseEvents(deltaChunk({ role: "assistant", content: "Should not run." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
          stopWhen: (state) => state.step >= 0,
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      const finishEvents = events.filter((event) => event.type === "request-finish")
      expect(finishEvents).toHaveLength(1)
      // No tool-result was emitted because stopWhen fired before dispatch
      expect(events.some((event) => event.type === "tool-result")).toBe(false)
    }),
  )

  it.effect("dispatches multiple tool calls in one step concurrently", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [OpenAIChat.adapter] })
      // Two tool calls in the same step; each accumulates in its own index.
      const body = `data: ${JSON.stringify({
        id: "x",
        choices: [
          {
            delta: {
              role: "assistant",
              tool_calls: [
                { index: 0, id: "c1", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
                { index: 1, id: "c2", function: { name: "get_weather", arguments: '{"city":"Tokyo"}' } },
              ],
            },
            finish_reason: null,
          },
        ],
        usage: null,
      })}\n\ndata: ${JSON.stringify({
        id: "x",
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: null,
      })}\n\ndata: [DONE]\n\n`

      const layer = scriptedResponses([
        body,
        sseEvents(deltaChunk({ role: "assistant", content: "Both done." }), finishChunk("stop")),
      ])

      const events = Array.from(
        yield* ToolRuntime.run(llm, {
          request: baseRequest,
          tools: { get_weather },
        }).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      const results = events.filter((event) => event.type === "tool-result")
      expect(results).toHaveLength(2)
      expect(results.map((event) => (event as { id: string }).id).sort()).toEqual(["c1", "c2"])
    }),
  )
})
