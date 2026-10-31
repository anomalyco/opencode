import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { ai, LanguageModel, type LLM, LLMEvent, tool, ToolFailure } from "../src/effect.js"
import { AI } from "../src/index.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { TestLLM } from "../src/testing.js"
import { testEffect } from "./lib/effect.js"

const model = LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route })
const it = testEffect(TestLLM.testLayer())

const read_file = tool({
  name: "read_file",
  description: "Read a file.",
  parameters: Schema.Struct({ path: Schema.String }),
  success: Schema.String,
  execute: ({ path }) =>
    path === "missing.txt" ? new ToolFailure({ message: `No such file: ${path}` }) : Effect.succeed("hello"),
})

const collect = (until?: LLM.LoopInput["until"]) =>
  ai.loop({ model, prompt: "Read the file.", tools: [read_file], until }).pipe(
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  )

describe("ai.loop", () => {
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
        TestLLM.toolCall("call-1", "read_file", { path: "missing.txt" }),
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

  it.effect("runs Promise tools, validating success and projecting toModelOutput", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-1", name: "add", input: { a: 2, b: 3 } }),
          LLMEvent.toolCall({ id: "call-2", name: "add", input: { a: -1, b: 0 } }),
        ),
        TestLLM.text("Done.", "text-1"),
      )
      const add = AI.tool({
        name: "add",
        description: "Add two numbers.",
        parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
        success: Schema.Number,
        execute: async ({ a, b }) => (a < 0 ? "negative" : a + b) as number,
        toModelOutput: ({ output }) => [{ type: "text", text: `sum=${output}` }],
      })

      const events = yield* ai.loop({ model, prompt: "Add.", tools: [add] }).pipe(Stream.runCollect)

      expect(Array.from(events).filter(LLMEvent.is.toolResult)).toEqual([
        expect.objectContaining({ id: "call-1", result: { type: "text", value: "sum=5" } }),
        expect.objectContaining({
          result: { type: "error", value: expect.stringContaining("invalid value for its success schema") },
        }),
      ])
    }),
  )

  it.effect("stops when until returns true without running that step's tools", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.always(TestLLM.toolCall("call-1", "read_file", { path: "a.txt" }))
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

  it.effect("sends tools in array order, after wire entries given before them", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.text("Done.", "text-1"))
      const search = tool({ name: "search", description: "Search.", parameters: Schema.String })

      yield* ai.generate({
        model,
        prompt: "Hi.",
        tools: [{ name: "hosted", description: "Hosted.", inputSchema: {} }, read_file, search],
      })

      expect((yield* client.requests())[0].tools.map((tool) => tool.name)).toEqual(["hosted", "read_file", "search"])
    }),
  )

  it.effect("fails the request when two tools share a name", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      const copy = tool({ name: "read_file", description: "Read again.", parameters: Schema.String })
      const loop = yield* ai
        .loop({ model, prompt: "Hi.", tools: [read_file, read_file] })
        .pipe(Stream.runDrain, Effect.flip)
      const generate = yield* ai.generate({ model, prompt: "Hi.", tools: [read_file, copy] }).pipe(Effect.flip)

      expect(loop.reason).toMatchObject({ _tag: "InvalidRequest", message: "Duplicate tool name: read_file" })
      expect(generate.reason).toMatchObject({ _tag: "InvalidRequest", message: "Duplicate tool name: read_file" })
      expect(yield* client.requests()).toHaveLength(0)
    }),
  )
})
