import { describe, expect, test } from "bun:test"
import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { Effect, Stream } from "effect"
import * as v from "valibot"
import { z } from "zod"
import { ai, ToolCallPart } from "../src/effect.js"
import { AI } from "../src/index.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { TestLLM } from "../src/testing.js"
import { toDefinitions, tool } from "../src/tool.js"
import { ToolRuntime } from "../src/tool-runtime.js"
import { testEffect } from "./lib/effect.js"

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const call = (name: string, input: unknown) => ToolCallPart.make({ id: "call_1", name, input })

describe("Standard Schema tool input", () => {
  test("sends the schema's own JSON Schema and validates arguments with Zod", async () => {
    const weather = tool({
      name: "weather",
      description: "Get the weather.",
      input: z.object({ city: z.string(), days: z.string().transform(Number) }),
      execute: (input) => Effect.succeed(`${input.city}:${input.days + 1}`),
    })

    expect(toDefinitions([weather])[0]?.inputSchema).toEqual({
      type: "object",
      properties: { city: { type: "string" }, days: { type: "string" } },
      required: ["city", "days"],
    })
    expect(
      (await Effect.runPromise(ToolRuntime.dispatch([weather], call("weather", { city: "Paris", days: "2" })))).result,
    ).toEqual({
      type: "text",
      value: "Paris:3",
    })
    expect(
      (await Effect.runPromise(ToolRuntime.dispatch([weather], call("weather", { city: 1, days: "2" })))).result,
    ).toEqual({
      type: "error",
      value: "Invalid tool input: city: Invalid input: expected string, received number",
    })
  })

  test("accepts a Valibot schema with a JSON Schema export in the Promise client", async () => {
    const weather = AI.tool({
      name: "weather",
      description: "Get the weather.",
      input: toStandardJsonSchema(v.object({ city: v.string() })),
      execute: (input) => input.city.toUpperCase(),
    })

    expect(toDefinitions([weather])[0]?.inputSchema).toMatchObject({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    })
    expect(
      (await Effect.runPromise(ToolRuntime.dispatch([weather], call("weather", { city: "Paris" })))).result,
    ).toEqual({
      type: "text",
      value: "PARIS",
    })
  })

  test("returns a throwing or rejecting validate as a tool error", async () => {
    const schema = (validate: () => never) => ({
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate,
        jsonSchema: { input: () => ({ type: "object" }), output: () => ({ type: "object" }) },
      },
    })
    const results = await Promise.all(
      [
        schema(() => {
          throw new Error("sync boom")
        }),
        schema(() => Promise.reject(new Error("async boom")) as never),
      ].map((input) =>
        Effect.runPromise(
          ToolRuntime.dispatch(
            [tool({ name: "boom", description: "Boom.", input, execute: () => Effect.succeed("ok") })],
            call("boom", {}),
          ),
        ),
      ),
    )
    expect(results.map((result) => result.result)).toEqual([
      { type: "error", value: "Invalid tool input: sync boom" },
      { type: "error", value: "Invalid tool input: async boom" },
    ])
  })

  test("fails clearly when the schema has no JSON Schema export", () => {
    expect(() =>
      tool({ name: "weather", description: "Get the weather.", input: v.object({ city: v.string() }) }),
    ).toThrow("This valibot schema has no JSON Schema export.")
  })
})

describe("Standard Schema structured output", () => {
  const scripted = testEffect(TestLLM.testLayer())

  scripted.effect("validates the answer and sends the schema's JSON Schema", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.toolCall("call-1", "generate_object", { city: "Paris" }))

      const events = Array.from(
        yield* ai
          .stream({ model, prompt: "Pick a city.", schema: z.object({ city: z.string() }) })
          .pipe(Stream.runCollect),
      )

      const finish = events.at(-1)
      expect(finish?.type === "finish" && finish.object.city).toBe("Paris")
      expect((yield* client.requests())[0]?.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      })
    }),
  )

  scripted.effect("fails the request when the answer does not match", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.toolCall("call-1", "generate_object", { city: 1 }))

      const error = yield* ai
        .generate({ model, prompt: "Pick a city.", schema: z.object({ city: z.string() }) })
        .pipe(Effect.flip)

      expect(error.message).toContain("schema decode failed: city: Invalid input: expected string")
    }),
  )
})
