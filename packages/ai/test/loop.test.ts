import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LanguageModel, LLM, LLMEvent, Tool, ToolFailure } from "../src/effect.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { TestLLM } from "../src/testing.js"
import { testEffect } from "./lib/effect.js"

const model = LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route })
const it = testEffect(TestLLM.testLayer())

const read_file = Tool.make({
  description: "Read a file.",
  parameters: Schema.Struct({ path: Schema.String }),
  success: Schema.String,
  execute: ({ path }) =>
    path === "missing.txt" ? new ToolFailure({ message: `No such file: ${path}` }) : Effect.succeed("hello"),
})

const collect = (until?: LLM.LoopInput["until"]) =>
  LLM.loop({ model, prompt: "Read the file.", tools: { read_file }, until }).pipe(
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  )

describe("LLM.loop", () => {
  it.effect("runs tool calls and sends the full assistant turn back to the model", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.textStart({ id: "text-1" }),
          LLMEvent.textDelta({ id: "text-1", text: "Reading." }),
          LLMEvent.textEnd({ id: "text-1" }),
          LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } }),
        ),
        TestLLM.text("The file says hello.", "text-2"),
      )

      const events = yield* collect()
      const requests = yield* client.requests()

      expect(requests[0].tools.map((tool) => tool.name)).toEqual(["read_file"])
      expect(requests[1].messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
      expect(requests[1].messages[1].content).toEqual([
        expect.objectContaining({ type: "text", text: "Reading." }),
        expect.objectContaining({ type: "tool-call", id: "call-1", name: "read_file", input: { path: "a.txt" } }),
      ])
      expect(requests[1].messages[2].content).toEqual([
        expect.objectContaining({ type: "tool-result", id: "call-1", result: { type: "text", value: "hello" } }),
      ])
      expect(events.filter(LLMEvent.is.toolResult)).toEqual([
        expect.objectContaining({ id: "call-1", result: { type: "text", value: "hello" } }),
      ])
      expect(events.filter(LLMEvent.is.stepStart).map((event) => event.index)).toEqual([0, 1])
      expect(events.filter(LLMEvent.is.finish)).toHaveLength(2)
      expect(events.at(-1)?.type).toBe("finish")
    }),
  )

  it.effect("sends a failing tool back to the model as an error result", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.tool("call-1", "read_file", { path: "missing.txt" }),
        TestLLM.text("That file does not exist.", "text-1"),
      )

      const events = yield* collect()
      const requests = yield* client.requests()

      expect(events.filter(LLMEvent.is.toolResult)).toEqual([
        expect.objectContaining({ id: "call-1", result: { type: "error", value: "No such file: missing.txt" } }),
      ])
      expect(requests[1].messages[2].content).toEqual([
        expect.objectContaining({ result: { type: "error", value: "No such file: missing.txt" } }),
      ])
      expect(events.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["That file does not exist."])
    }),
  )

  it.effect("stops when until returns true without running that step's tools", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.always(TestLLM.tool("call-1", "read_file", { path: "a.txt" }))
      const seen: number[] = []

      const events = yield* collect(({ steps }) => {
        seen.push(steps.length)
        expect(steps.at(-1)?.toolCalls.map((call) => call.id)).toEqual(["call-1"])
        return steps.length >= 2
      })

      expect(seen).toEqual([1, 2])
      expect(yield* client.requests()).toHaveLength(2)
      expect(events.filter(LLMEvent.is.toolResult)).toHaveLength(1)
      expect(events.at(-1)?.type).toBe("finish")
    }),
  )
  it.effect("stops after a step that reports a provider error without running its tools", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } }),
        LLMEvent.providerError({ message: "Overloaded" }),
      ])

      const events = yield* collect()

      expect(yield* client.requests()).toHaveLength(1)
      expect(events.filter(LLMEvent.is.toolResult)).toHaveLength(0)
      expect(events.at(-1)).toEqual(expect.objectContaining({ type: "provider-error", message: "Overloaded" }))
    }),
  )
})
