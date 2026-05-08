import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM } from "../src"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { Tool, toDefinitions } from "../src/tool"
import { it } from "./lib/effect"
import { dynamicResponse } from "./lib/http"
import { finishChunk, toolCallChunk } from "./lib/openai-chunks"
import { sseEvents } from "./lib/sse"

type OpenAIChatBody = {
  readonly tool_choice?: unknown
  readonly tools?: ReadonlyArray<{
    readonly function: {
      readonly parameters: unknown
    }
  }>
}

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  baseURL: "https://api.openai.test/v1/",
  headers: { authorization: "Bearer test" },
})

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)
const decodeBody = (text: string): OpenAIChatBody => decodeJson(text) as OpenAIChatBody

describe("Tool.make (dynamic JSON Schema)", () => {
  test("forwards JSON Schema and description through toDefinitions", () => {
    const jsonSchema = {
      type: "object" as const,
      properties: { city: { type: "string" } },
      required: ["city"],
    }
    const lookup = Tool.make({
      description: "Look up something",
      jsonSchema,
      execute: () => Effect.succeed({ ok: true }),
    })
    const [definition] = toDefinitions({ lookup })
    expect(definition?.name).toBe("lookup")
    expect(definition?.description).toBe("Look up something")
    expect(definition?.inputSchema).toEqual(jsonSchema)
  })

  test("execute receives the raw input untouched", async () => {
    const seen: unknown[] = []
    const tool = Tool.make({
      description: "echo",
      jsonSchema: { type: "object" },
      execute: (params) =>
        Effect.sync(() => {
          seen.push(params)
          return { ok: true }
        }),
    })
    const result = await Effect.runPromise(tool.execute({ hello: "world" }))
    expect(seen).toEqual([{ hello: "world" }])
    expect(result).toEqual({ ok: true })
  })
})

describe("LLM.generateObject", () => {
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

      const response = yield* LLM.generateObject({
        model,
        prompt: "Return a structured weather report.",
        schema: Schema.Struct({ city: Schema.String, temp: Schema.Number }),
      }).pipe(Effect.provide(layer))

      expect(response.object).toEqual({ city: "Paris", temp: 22 })
      expect(response.response.toolCalls).toHaveLength(1)
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

      const response = yield* LLM.generateObject({
        model,
        prompt: "Extract the user.",
        jsonSchema: {
          type: "object",
          properties: { name: { type: "string" }, age: { type: "number" } },
          required: ["name", "age"],
        },
      }).pipe(Effect.provide(layer))

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

      const exit = yield* LLM.generateObject({
        model,
        prompt: "Return a structured value.",
        schema: Schema.Struct({ value: Schema.Number }),
      }).pipe(Effect.provide(layer), Effect.exit)

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

      const exit = yield* LLM.generateObject({
        model,
        prompt: "Return a structured value.",
        schema: Schema.Struct({ value: Schema.Number }),
      }).pipe(Effect.provide(layer), Effect.exit)

      expect(exit._tag).toBe("Failure")
    }),
  )
})
