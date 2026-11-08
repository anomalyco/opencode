import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import {
  ai,
  AIError,
  LanguageModel,
  type LLM,
  LLMEvent,
  ProviderInternalError,
  tool,
  ToolFailure,
} from "../src/effect.js"
import { AI } from "../src/index.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { TestLLM } from "../src/testing.js"
import { testEffect } from "./lib/effect.js"

const model = LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route })
const it = testEffect(TestLLM.testLayer())

const read_file = tool({
  name: "read_file",
  description: "Read a file.",
  input: Schema.Struct({ path: Schema.String }),
  success: Schema.String,
  execute: ({ path }) =>
    path === "missing.txt" ? new ToolFailure({ message: `No such file: ${path}` }) : Effect.succeed("hello"),
})

const collect = (until?: LLM.LLMLoopInput["until"]) =>
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
      expect(events.filter(LLMEvent.is.stepFinish).map((event) => event.index)).toEqual([0, 1])
      expect(events.filter(LLMEvent.is.finish)).toHaveLength(1)
      expect(events.at(-1)?.type).toBe("finish")
    }),
  )

  it.effect("ends with one finish carrying the final reason and usage summed across steps", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.complete(
          {
            reason: { normalized: "tool-calls" },
            usage: { inputTokens: 10, outputTokens: 4, contextTokens: 10, cost: 0.5 },
          },
          LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } }),
        ),
        TestLLM.complete(
          { reason: { normalized: "stop" }, usage: { inputTokens: 20, outputTokens: 6, contextTokens: 20 } },
          LLMEvent.textDelta({ id: "text-1", text: "Done." }),
        ),
      )

      const events = yield* collect()

      expect(events.filter(LLMEvent.is.stepFinish).map((event) => event.usage?.inputTokens)).toEqual([10, 20])
      const finishes = events.filter(LLMEvent.is.finish)
      expect(finishes).toHaveLength(1)
      expect(events.at(-1)).toBe(finishes[0])
      expect(finishes[0].reason.normalized).toBe("stop")
      expect(finishes[0].usage).toMatchObject({ inputTokens: 30, outputTokens: 10, contextTokens: 20, cost: 0.5 })
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
      expect(events.filter((event) => event.type.startsWith("tool-") && event.type !== "tool-call")).toHaveLength(1)
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
        input: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
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
  it.effect("sends unparseable tool input back to the model as an error result and continues", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(LLMEvent.toolInputError({ id: "call-1", name: "read_file", raw: '{"path": "a.txt"' })),
        TestLLM.toolCall("call-2", "read_file", { path: "a.txt" }),
        TestLLM.text("The file says hello.", "text-1"),
      )

      const events = yield* collect()
      const requests = yield* client.requests()
      const error = {
        type: "error",
        value: 'Invalid tool arguments: the input is not valid JSON. Received: {"path": "a.txt"',
      } as const

      expect(requests).toHaveLength(3)
      expect(requests[1].messages[1].content).toEqual([
        expect.objectContaining({ type: "tool-call", id: "call-1", name: "read_file", input: {} }),
      ])
      expect(requests[1].messages[2].content).toEqual([
        expect.objectContaining({ type: "tool-result", id: "call-1", result: error }),
      ])
      expect(events.filter(LLMEvent.is.toolResult).map((event) => event.result)).toEqual([
        error,
        { type: "text", value: "hello" },
      ])
    }),
  )

  it.effect("stops at the output token limit without running the step's tool calls", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.complete(
          { reason: { normalized: "length" } },
          LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } }),
          LLMEvent.toolInputError({ id: "call-2", name: "read_file", raw: '{"path": "b' }),
        ),
      )

      const events = yield* collect()

      expect(yield* client.requests()).toHaveLength(1)
      expect(events.filter(LLMEvent.is.toolResult)).toHaveLength(0)
      expect(events.at(-1)).toEqual(expect.objectContaining({ type: "finish", reason: { normalized: "length" } }))
    }),
  )

  it.effect("forces the caller's toolChoice on the first step only", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCall("call-1", "read_file", { path: "a.txt" }),
        TestLLM.text("The file says hello.", "text-1"),
      )

      yield* ai
        .loop({
          model,
          prompt: "Read the file.",
          tools: [read_file],
          toolChoice: { type: "required", disableParallelToolUse: true },
        })
        .pipe(Stream.runDrain)
      const requests = yield* client.requests()

      expect(requests.map((request) => ({ ...request.toolChoice }))).toEqual([
        { type: "required", disableParallelToolUse: true },
        { type: "auto", disableParallelToolUse: true },
      ])
    }),
  )

  it.effect("keeps the answer tool forced on every step with schema", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCall("call-1", "read_file", { path: "a.txt" }),
        TestLLM.toolCall("call-2", "generate_object", { text: "hello" }),
      )

      yield* ai
        .loop({
          model,
          prompt: "Read the file.",
          tools: [read_file],
          toolChoice: "read_file",
          schema: Schema.Struct({ text: Schema.String }),
        })
        .pipe(Stream.runDrain)

      expect((yield* client.requests()).map((request) => request.toolChoice?.type)).toEqual(["required", "required"])
    }),
  )

  it.effect("fails without running tools when a step's stream fails", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.failAfter(
          new AIError({ reason: new ProviderInternalError({ message: "Overloaded" }) }),
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } }),
        ),
      )

      const error = yield* collect().pipe(Effect.flip)

      expect(yield* client.requests()).toHaveLength(1)
      expect(error.reason.message).toBe("Overloaded")
      expect(error.partial?.toolCalls.map((call) => call.id)).toEqual(["call-1"])
    }),
  )

  it.effect("sends tools in array order, after wire entries given before them", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.text("Done.", "text-1"))
      const search = tool({ name: "search", description: "Search.", input: Schema.String })

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
      const copy = tool({ name: "read_file", description: "Read again.", input: Schema.String })
      const loop = yield* ai
        .loop({ model, prompt: "Hi.", tools: [read_file, read_file] })
        .pipe(Stream.runDrain, Effect.flip)
      const generate = yield* ai.generate({ model, prompt: "Hi.", tools: [read_file, copy] }).pipe(Effect.flip)

      expect(loop.reason).toMatchObject({ _tag: "InvalidRequest", message: "Duplicate tool name: read_file" })
      expect(generate.reason).toMatchObject({ _tag: "InvalidRequest", message: "Duplicate tool name: read_file" })
      expect(yield* client.requests()).toHaveLength(0)
    }),
  )

  it.effect("fails untyped input that has neither or both of prompt and messages", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      const untyped = (input: object) => input as LLM.LLMRequestInput
      const message = "Pass exactly one of `prompt` or `messages`, not both or neither"
      const neither = yield* ai.generate(untyped({ model })).pipe(Effect.flip)
      const both = yield* ai
        .loop({ ...untyped({ model, prompt: "Hi.", messages: [] }), tools: [read_file] })
        .pipe(Stream.runDrain, Effect.flip)

      expect(neither.reason).toMatchObject({ _tag: "InvalidRequest", message })
      expect(both.reason).toMatchObject({ _tag: "InvalidRequest", message })
      expect(() => ai.request(untyped({ model, system: "Be brief." }))).toThrow(message)
      expect(yield* client.requests()).toHaveLength(0)
    }),
  )
})

describe("ai.collect", () => {
  it.effect("folds a stream into one step whose finish carries the message and usage", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.textWithUsage("Hello.", "text-1", 7))

      const events = Array.from(yield* ai.stream({ model, prompt: "Say hello." }).pipe(Stream.runCollect))
      const finish = events.find(LLMEvent.is.finish)
      expect(finish?.message?.content).toEqual([expect.objectContaining({ type: "text", text: "Hello." })])
      expect(finish?.usage?.inputTokens).toBe(7)

      yield* client.push(TestLLM.textWithUsage("Hello.", "text-1", 7))
      const result = yield* ai.collect(ai.stream({ model, prompt: "Say hello." }))
      expect(result.text).toBe("Hello.")
      expect(result.steps).toHaveLength(1)
      expect(result.messages).toEqual([result.steps[0].message])
      expect(finish?.message).toEqual(result.steps[0].message)
      expect(result.usage?.inputTokens).toBe(7)
      expect(result.finishReason.normalized).toBe("stop")
    }),
  )

  it.effect("folds a loop into its steps, one message per step and tool result, and the total usage", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.complete(
          { reason: { normalized: "tool-calls" }, usage: { inputTokens: 10 } },
          LLMEvent.textStart({ id: "text-1" }),
          LLMEvent.textDelta({ id: "text-1", text: "Reading." }),
          LLMEvent.textEnd({ id: "text-1" }),
          LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } }),
        ),
        TestLLM.complete(
          { reason: { normalized: "stop" }, usage: { inputTokens: 20 } },
          LLMEvent.textDelta({ id: "text-2", text: "The file says hello." }),
        ),
      )

      const result = yield* ai.collect(ai.loop({ model, prompt: "Read the file.", tools: [read_file] }))
      const requests = yield* client.requests()

      expect(result.text).toBe("The file says hello.")
      expect(result.steps.map((step) => step.text)).toEqual(["Reading.", "The file says hello."])
      expect(result.steps.map((step) => step.usage?.inputTokens)).toEqual([10, 20])
      expect(result.usage?.inputTokens).toBe(30)
      expect(result.messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"])
      // The first two messages are exactly what the loop sent back for the second step.
      expect(result.messages.slice(0, 2)).toEqual(requests[1].messages.slice(1))
    }),
  )

  it.effect("gives each error result for unparseable tool input its call, as the loop sent it", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(LLMEvent.toolInputError({ id: "call-1", name: "read_file", raw: '{"path": "a.txt"' })),
        TestLLM.text("Sorry.", "text-1"),
      )

      const result = yield* ai.collect(ai.loop({ model, prompt: "Read the file.", tools: [read_file] }))
      const requests = yield* client.requests()

      expect(result.messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"])
      expect(result.messages[0].content).toEqual([
        expect.objectContaining({ type: "tool-call", id: "call-1", name: "read_file", input: {} }),
      ])
      expect(result.messages.slice(0, 2)).toEqual(requests[1].messages.slice(1))
    }),
  )

  it.effect("carries the decoded object when the stream has a schema", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.toolCall("call-1", "generate_object", { path: "a.txt" }))

      const result = yield* ai.collect(
        ai.stream({ model, prompt: "Pick a file.", schema: Schema.Struct({ path: Schema.String }) }),
      )

      const path: string = result.object.path
      expect(path).toBe("a.txt")
    }),
  )

  it.effect("fails when the stream ends without a finish event", () =>
    Effect.gen(function* () {
      const error = yield* ai.collect(Stream.make(LLMEvent.stepStart({ index: 0 }))).pipe(Effect.flip)
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
    }),
  )
})
