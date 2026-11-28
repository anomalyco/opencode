import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { ai, LLMEvent, Message } from "../src/effect.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { toDefinitions, tool } from "../src/tool.js"
import { normalizeToolHistory } from "../src/tool-history.js"
import { TestLLM } from "../src/testing.js"
import { it, testEffect } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { finishChunk, toolCallChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"

type OpenAIChatBody = {
  readonly tool_choice?: unknown
  readonly tools?: ReadonlyArray<{
    readonly function: {
      readonly parameters: unknown
    }
  }>
}

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)
const decodeBody = (text: string): OpenAIChatBody => decodeJson(text) as OpenAIChatBody

describe("tool (dynamic JSON Schema)", () => {
  test("forwards JSON Schema and description through toDefinitions", () => {
    const jsonSchema = {
      type: "object" as const,
      properties: { city: { type: "string" } },
      required: ["city"],
    }
    const lookup = tool({
      name: "lookup",
      description: "Look up something",
      input: jsonSchema,
      execute: () => Effect.succeed({ ok: true }),
    })
    const [definition] = toDefinitions([lookup])
    expect(definition?.name).toBe("lookup")
    expect(definition?.description).toBe("Look up something")
    expect(definition?.inputSchema).toEqual(jsonSchema)
  })

  it.effect("execute receives the raw input untouched", () =>
    Effect.gen(function* () {
      const seen: unknown[] = []
      const echo = tool({
        name: "echo",
        description: "echo",
        input: { type: "object" },
        execute: (params) =>
          Effect.sync(() => {
            seen.push(params)
            return { ok: true }
          }),
      })
      const result = yield* echo.execute({ hello: "world" })
      expect(seen).toEqual([{ hello: "world" }])
      expect(result).toEqual({ ok: true })
    }),
  )
})

describe("ai.generate with schema", () => {
  it.effect("forces a synthetic tool call and decodes the input", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(decodeBody(input.text))
          return input.respond(
            sseEvents(
              toolCallChunk("call_1", "generate_object", '{"city":"Paris","temp":22}'),
              finishChunk("tool_calls"),
            ),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )

      const response = yield* ai
        .generate({
          model,
          prompt: "Return a structured weather report.",
          schema: Schema.Struct({ city: Schema.String, temp: Schema.Number }),
        })
        .pipe(Effect.provide(layer))

      expect(response.object).toEqual({ city: "Paris", temp: 22 })
      expect(response.toolCalls).toHaveLength(1)
      expect(bodies).toHaveLength(1)
      expect(bodies[0].tool_choice).toEqual({ type: "function", function: { name: "generate_object" } })
      const tool = bodies[0].tools?.[0]
      expect(bodies[0].tools).toHaveLength(1)
      expect(tool).toMatchObject({
        type: "function",
        function: { name: "generate_object" },
      })
      const params = tool?.function.parameters as {
        readonly type?: unknown
        readonly required?: unknown
        readonly properties?: Record<string, unknown>
      }
      expect(params.type).toBe("object")
      expect(params.required).toEqual(["city", "temp"])
      expect(params.properties?.city).toMatchObject({ type: "string" })
      expect(params.properties?.temp).toBeDefined()
    }),
  )

  it.effect("accepts a raw JSON Schema and returns the input untouched", () =>
    Effect.gen(function* () {
      const bodies: OpenAIChatBody[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(decodeBody(input.text))
          return input.respond(
            sseEvents(toolCallChunk("call_1", "generate_object", '{"name":"Ada","age":30}'), finishChunk("tool_calls")),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )

      const response = yield* ai
        .generate({
          model,
          prompt: "Extract the user.",
          schema: {
            type: "object",
            properties: { name: { type: "string" }, age: { type: "number" } },
            required: ["name", "age"],
          },
        })
        .pipe(Effect.provide(layer))

      expect(response.object).toEqual({ name: "Ada", age: 30 })
      expect(bodies[0].tools?.[0]?.function.parameters).toEqual({
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name", "age"],
      })
    }),
  )

  it.effect("fails when the model does not call the synthetic tool", () =>
    Effect.gen(function* () {
      const layer = dynamicResponse((input) =>
        Effect.sync(() =>
          input.respond(sseEvents({ id: "x", choices: [{ delta: { content: "no thanks" }, finish_reason: "stop" }] }), {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      )

      const exit = yield* ai
        .generate({
          model,
          prompt: "Return a structured value.",
          schema: Schema.Struct({ value: Schema.Number }),
        })
        .pipe(Effect.provide(layer), Effect.exit)

      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("fails with a decode error when the tool input does not match the schema", () =>
    Effect.gen(function* () {
      const layer = dynamicResponse((input) =>
        Effect.sync(() =>
          input.respond(
            sseEvents(
              toolCallChunk("call_1", "generate_object", '{"value":"not-a-number"}'),
              finishChunk("tool_calls"),
            ),
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
      )

      const error = yield* ai
        .generate({
          model,
          prompt: "Return a structured value.",
          schema: Schema.Struct({ value: Schema.Number }),
        })
        .pipe(Effect.provide(layer), Effect.flip)

      expect(error.message).toContain("schema decode failed")
      expect(error.partial?.toolCalls[0]?.input).toEqual({ value: "not-a-number" })
    }),
  )

  it.effect("replays the decoded answer into the next chat request", () =>
    Effect.gen(function* () {
      type ChatBody = OpenAIChatBody & {
        readonly messages: ReadonlyArray<{
          readonly role?: string
          readonly tool_call_id?: string
          readonly content?: unknown
        }>
      }
      const bodies: ChatBody[] = []
      const layer = dynamicResponse((input) =>
        Effect.sync(() => {
          bodies.push(decodeBody(input.text) as ChatBody)
          return input.respond(
            sseEvents(
              ...(bodies.length === 1
                ? [
                    toolCallChunk("call_1", "generate_object", '{"count":42,"type":"text","value":"ok"}'),
                    finishChunk("tool_calls"),
                  ]
                : [{ id: "x", choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
            ),
            { headers: { "content-type": "text/event-stream" } },
          )
        }),
      )

      const first = yield* ai
        .collect(
          ai.stream({
            model,
            prompt: "Count.",
            schema: Schema.Struct({ count: Schema.Number, type: Schema.String, value: Schema.String }),
          }),
        )
        .pipe(Effect.provide(layer))

      expect(first.object).toEqual({ count: 42, type: "text", value: "ok" })

      yield* ai
        .generate({ model, messages: [...first.messages, Message.user("Again?")] })
        .pipe(Effect.provide(layer))

      expect(bodies).toHaveLength(2)
      expect(bodies[1].messages).toContainEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: '{"count":42,"type":"text","value":"ok"}',
      })
      expect(JSON.stringify(bodies[1].messages)).not.toContain("Tool result missing")
    }),
  )
})

describe("schema on ai.stream and ai.loop", () => {
  const City = Schema.Struct({ city: Schema.String })
  const scripted = testEffect(TestLLM.testLayer())
  const echo = tool({
    name: "echo",
    description: "Echo a value.",
    input: Schema.Struct({ value: Schema.String }),
    execute: ({ value }) => Effect.succeed(value),
  })

  scripted.effect("reports the token limit instead of a decode error when output is cut off", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.complete(
          { reason: { normalized: "length" } },
          LLMEvent.toolCall({ id: "call-1", name: "generate_object", input: {} }),
        ),
      )

      const error = yield* ai.generate({ model, prompt: "Pick a city.", schema: City, maxTokens: 1 }).pipe(Effect.flip)

      expect(error.message).toContain("output hit the token limit")
      expect(error.message).not.toContain("schema decode failed")
      expect(error.partial?.toolCalls[0]?.name).toBe("generate_object")
    }),
  )

  scripted.effect("stream puts the decoded object on finish", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.toolCall("call-1", "generate_object", { city: "Paris" }))

      const events = Array.from(
        yield* ai.stream({ model, prompt: "Pick a city.", schema: City }).pipe(Stream.runCollect),
      )

      const finish = events.at(-1)
      expect(finish?.type === "finish" && finish.object).toEqual({ city: "Paris" })
    }),
  )

  scripted.effect("loop runs tools, leaves the answer tool alone and decodes it on the loop's one finish", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.toolCall("call-1", "echo", { value: "Paris" }))
      yield* client.push(TestLLM.toolCall("call-2", "generate_object", { city: "Paris" }))

      const events = Array.from(
        yield* ai.loop({ model, prompt: "Pick a city.", tools: [echo], schema: City }).pipe(Stream.runCollect),
      )

      expect(events.filter(LLMEvent.is.toolResult).map((event) => event.name)).toEqual(["echo"])
      expect(events.filter((event) => event.type === "finish").map((event) => event.object)).toEqual([
        { city: "Paris" },
      ])
      expect((yield* client.requests())[0]?.toolChoice?.type).toBe("required")
    }),
  )

  scripted.effect("loop ends at a step that calls the answer tool alongside another tool", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-1", name: "echo", input: { value: "Paris" } }),
          LLMEvent.toolCall({ id: "call-2", name: "generate_object", input: { city: "Paris" } }),
        ),
      )

      const events = Array.from(
        yield* ai.loop({ model, prompt: "Pick a city.", tools: [echo], schema: City }).pipe(Stream.runCollect),
      )

      expect(events.some(LLMEvent.is.toolResult)).toBe(false)
      expect(events.filter((event) => event.type === "finish").map((event) => event.object)).toEqual([
        { city: "Paris" },
      ])
      expect(yield* client.requests()).toHaveLength(1)
    }),
  )

  scripted.effect("collect replays a decoded answer as its raw tool result without an event", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCall("call-1", "generate_object", { count: 42, type: "text", value: "ok" }),
      )

      const Answer = Schema.Struct({ count: Schema.Number, type: Schema.String, value: Schema.String })
      const result = yield* ai.collect(ai.stream({ model, prompt: "Count.", schema: Answer }))

      expect(result.object).toEqual({ count: 42, type: "text", value: "ok" })
      // `{ type, value }` is itself a tool-result shape; the replay must keep the raw answer, not re-tag it.
      expect(result.messages).toEqual([
        result.steps[0]?.message,
        Message.tool({
          id: "call-1",
          name: "generate_object",
          result: { type: "json", value: { count: 42, type: "text", value: "ok" } },
        }),
      ])
    }),
  )

  scripted.effect("loop keeps running client tools when a hosted call reuses the answer name", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-1", name: "echo", input: { value: "Paris" } }),
          LLMEvent.toolCall({
            id: "call-2",
            name: "generate_object",
            input: { city: "ignored" },
            providerExecuted: true,
          }),
        ),
        TestLLM.toolCall("call-3", "generate_object", { city: "Paris" }),
      )

      const result = yield* ai.collect(ai.loop({ model, prompt: "Pick a city.", tools: [echo], schema: City }))

      expect(result.object).toEqual({ city: "Paris" })
      expect(result.messages.filter((message) => message.role === "tool").map((message) => message.content)).toEqual([
        [expect.objectContaining({ type: "tool-result", id: "call-1", name: "echo" })],
        [expect.objectContaining({ type: "tool-result", id: "call-3", name: "generate_object" })],
      ])
      expect(yield* client.requests()).toHaveLength(2)
    }),
  )

  scripted.effect("generate ignores a provider-executed call that reuses the answer name", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({
            id: "call-1",
            name: "generate_object",
            input: { city: "Paris" },
            providerExecuted: true,
          }),
        ),
      )

      const error = yield* ai.generate({ model, prompt: "Pick a city.", schema: City }).pipe(Effect.flip)

      expect(error.message).toContain("did not call the forced `generate_object` tool")
    }),
  )

  scripted.effect("same-id siblings keep the answer settled and only repair the unrun call", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-1", name: "generate_object", input: { city: "Paris" } }),
          LLMEvent.toolCall({ id: "call-1", name: "echo", input: { value: "x" } }),
        ),
      )

      const result = yield* ai.collect(ai.loop({ model, prompt: "Pick a city.", tools: [echo], schema: City }))
      const replayed = normalizeToolHistory([...result.messages, Message.user("Again.")])

      expect(result.object).toEqual({ city: "Paris" })
      expect(replayed.slice(0, 2)).toEqual([
        result.messages[0],
        Message.tool({ id: "call-1", name: "generate_object", result: { type: "json", value: { city: "Paris" } } }),
      ])
      expect(replayed[2]).toEqual(
        Message.tool({
          id: "call-1",
          name: "echo",
          result: { type: "error", value: "Tool result missing" },
        }),
      )
    }),
  )

  scripted.effect("replays the answer before a same-id sibling that ran first", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-1", name: "echo", input: { value: "x" } }),
          LLMEvent.toolCall({ id: "call-1", name: "generate_object", input: { city: "Paris" } }),
        ),
      )

      const result = yield* ai.collect(ai.loop({ model, prompt: "Pick a city.", tools: [echo], schema: City }))
      const replayed = normalizeToolHistory([...result.messages, Message.user("Again.")])

      expect(result.object).toEqual({ city: "Paris" })
      expect(replayed[1]).toEqual(
        Message.tool({
          id: "call-1",
          name: "generate_object",
          result: { type: "json", value: { city: "Paris" } },
        }),
      )
      expect(replayed[2]).toEqual(
        Message.tool({
          id: "call-1",
          name: "echo",
          result: { type: "error", value: "Tool result missing" },
        }),
      )
    }),
  )
})
