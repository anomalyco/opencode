import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import * as Tool from "../src/v2/effect/tool"

test("tools remain valid across separate module instances", async () => {
  const ForeignTool = await import(`${new URL("../src/v2/effect/tool.ts", import.meta.url).href}?foreign`)
  const config = {
    description: "Foreign tool",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ ok: Schema.Boolean }),
    execute: () => Effect.succeed({ output: { ok: true } }),
  }
  const tool = ForeignTool.make(config)

  expect(Tool.toLLMDefinition("foreign", tool)).toEqual({
    name: "foreign",
    description: "Foreign tool",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
  })
  expect(await Effect.runPromise(Tool.decodeInput(tool.input, { value: "input" }))).toEqual({ value: "input" })
})

test("portable schemas validate and describe typed tools", async () => {
  const input: Tool.StandardSchemaType<{ count: string }, { count: number }> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        if (typeof value !== "object" || value === null || !("count" in value) || typeof value.count !== "string")
          return { issues: [{ message: "count must be numeric" }] }
        const count = Number(value.count)
        return Number.isFinite(count) ? { value: { count } } : { issues: [{ message: "count must be numeric" }] }
      },
      jsonSchema: {
        input: () => ({ type: "object", properties: { count: { type: "string" } } }),
        output: () => ({ type: "object", properties: { count: { type: "number" } } }),
      },
    },
  }
  const output: Tool.StandardSchemaType<number, string> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({ value: String(value) }),
      jsonSchema: {
        input: () => ({ type: "number" }),
        output: () => ({ type: "string" }),
      },
    },
  }
  const tool = Tool.make({
    description: "Portable tool",
    input,
    output,
    execute: ({ count }) => Effect.succeed({ output: count + 1 }),
  })

  expect(Tool.toLLMDefinition("portable", tool)).toEqual({
    name: "portable",
    description: "Portable tool",
    inputSchema: { type: "object", properties: { count: { type: "string" } } },
    outputSchema: { type: "string" },
  })
  const decoded = await Effect.runPromise(Tool.decodeInput(tool.input, { count: "41" }))
  expect(decoded).toEqual({ count: 41 })
  expect(await Effect.runPromise(Tool.encodeOutput(tool.output, 42))).toBe("42")
})

test("portable schema failures become tool failures", async () => {
  const input: Tool.StandardSchemaType<string> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => ({ issues: [{ message: "expected a string" }] }),
      jsonSchema: {
        input: () => ({ type: "string" }),
        output: () => ({ type: "string" }),
      },
    },
  }

  const error = await Effect.runPromiseExit(Tool.decodeInput(input, 1))
  expect(error.toString()).toContain("Invalid tool input: expected a string")
})

test("canonical results carry metadata with typed output", async () => {
  const input = Schema.Struct({ value: Schema.String })
  const output = Schema.Struct({ value: Schema.String, internal: Schema.Boolean })
  const tool = Tool.make({
    description: "Annotated tool",
    input,
    output,
    execute: ({ value }) => Effect.succeed({ output: { value, internal: true }, metadata: { value }, content: value }),
  })

  expect(await Effect.runPromise(tool.execute({ value: "out" }, {} as Tool.Context))).toEqual({
    output: { value: "out", internal: true },
    metadata: { value: "out" },
    content: "out",
  })
})

test("raw JSON schemas are render-only and omitted output means model-only", async () => {
  const tool = Tool.make({
    description: "Raw tool",
    input: { type: "object", properties: { value: { type: "string" } } },
    execute: (input) => Effect.succeed({ content: JSON.stringify(input) }),
  })

  expect(Tool.toLLMDefinition("raw", tool)).toEqual({
    name: "raw",
    description: "Raw tool",
    inputSchema: { type: "object", properties: { value: { type: "string" } } },
  })
  expect(await Effect.runPromise(Tool.decodeInput(tool.input, { value: 1 }))).toEqual({ value: 1 })
})
