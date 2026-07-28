import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import type { Info } from "@opencode-ai/schema/tool"
import { Tool } from "../src/tool"
import { definition, execute } from "../src/tool/runtime"

test("tools are structural values", async () => {
  const config = {
    name: "foreign",
    description: "Foreign tool",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ ok: Schema.Boolean }),
    execute: () => Effect.succeed({ output: { ok: true } }),
  }
  const tool: Info = config

  expect(definition(tool)).toEqual({
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
})

test("Effect tool schemas use exact optional keys and flatten compatible constraints", () => {
  const tool: Info = {
    name: "constraints",
    description: "Constraints",
    input: Schema.Struct({
      offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      code: Schema.String.check(Schema.isPattern(/^a/), Schema.isPattern(/z$/)),
    }),
    execute: () => Effect.succeed({ content: "unused" }),
  }

  expect(definition(tool).inputSchema).toEqual({
    type: "object",
    properties: {
      offset: { type: "integer", minimum: 0 },
      code: { type: "string", allOf: [{ pattern: "^a" }, { pattern: "z$" }] },
    },
    required: ["code"],
    additionalProperties: false,
  })
})

test("Effect tool schemas inline named child schemas", () => {
  const Child = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Child" })
  const tool: Info = {
    name: "references",
    description: "References",
    input: Schema.Struct({ child: Child.annotate({ description: "Child value" }) }),
    execute: () => Effect.succeed({ content: "unused" }),
  }

  expect(definition(tool).inputSchema).toEqual({
    type: "object",
    properties: {
      child: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
        description: "Child value",
      },
    },
    required: ["child"],
    additionalProperties: false,
  })
})

test("Effect tool schemas resolve escaped definition names", () => {
  const Slash = Schema.Struct({ slash: Schema.String }).annotate({ identifier: "A/B" })
  const Tilde = Schema.Struct({ tilde: Schema.String }).annotate({ identifier: "A~B" })
  const tool: Info = {
    name: "escaped-references",
    description: "Escaped references",
    input: Schema.Struct({ slash: Slash, tilde: Tilde }),
    execute: () => Effect.succeed({ content: "unused" }),
  }

  expect(JSON.stringify(definition(tool).inputSchema)).not.toContain("$ref")
  expect(JSON.stringify(definition(tool).inputSchema)).not.toContain("$defs")
})

test("portable schemas validate and describe typed tools", async () => {
  const input = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => {
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
  const output = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: String(value) }),
      jsonSchema: {
        input: () => ({ type: "number" }),
        output: () => ({ type: "string" }),
      },
    },
  }
  const tool: Info = ({
    name: "portable",
    description: "Portable tool",
    input,
    output,
    execute: ({ count }) => Effect.succeed({ output: count + 1 }),
  })

  expect(definition(tool)).toEqual({
    name: "portable",
    description: "Portable tool",
    inputSchema: { type: "object", properties: { count: { type: "string" } } },
    outputSchema: { type: "string" },
  })
  const result = await Effect.runPromise(execute(tool, { count: "41" }, {} as Tool.Context))
  expect(result.output).toBe("42")
})

test("portable schema failures become tool failures", async () => {
  const input = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (_value: unknown) => ({ issues: [{ message: "expected a string" }] }),
      jsonSchema: {
        input: () => ({ type: "string" }),
        output: () => ({ type: "string" }),
      },
    },
  }

  const error = await Effect.runPromiseExit(
    execute(
      {
        name: "invalid",
        description: "Invalid",
        input,
        execute: () => Effect.succeed({ content: "unused" }),
      },
      1,
      {} as Tool.Context,
    ),
  )
  expect(error.toString()).toContain("Invalid tool input: expected a string")
})

test("canonical results carry metadata with typed output", async () => {
  const input = Schema.Struct({ value: Schema.String })
  const output = Schema.Struct({ value: Schema.String, internal: Schema.Boolean })
  const tool: Info = ({
    name: "annotated",
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
  const input = { type: "object", properties: { value: { type: "string" } } }
  const tool: Info = ({
    name: "raw",
    description: "Raw tool",
    input,
    execute: (input) => Effect.succeed({ content: JSON.stringify(input) }),
  })

  expect(definition(tool)).toEqual({
    name: "raw",
    description: "Raw tool",
    inputSchema: { type: "object", properties: { value: { type: "string" } } },
  })
  expect(await Effect.runPromise(execute(tool, { value: 1 }, {} as Tool.Context))).toEqual({
    output: undefined,
    content: [{ type: "text", text: '{"value":1}' }],
  })
})

test("missing external input schemas fall back to an empty schema", () => {
  const tool = {
    name: "external",
    description: "External tool",
    input: undefined,
    execute: () => Effect.succeed({ content: "unused" }),
  } as unknown as Info

  expect(definition(tool)).toEqual({
    name: "external",
    description: "External tool",
    inputSchema: {},
  })
})
