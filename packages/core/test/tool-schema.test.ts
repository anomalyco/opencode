import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { z } from "zod"
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
      code: { type: "string", pattern: "^a", allOf: [{ pattern: "z$" }] },
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
  const tool: Info = {
    name: "portable",
    description: "Portable tool",
    input,
    output,
    execute: ({ count }) => Effect.succeed({ output: count + 1 }),
  }

  expect(definition(tool)).toEqual({
    name: "portable",
    description: "Portable tool",
    inputSchema: { type: "object", properties: { count: { type: "string" } } },
    outputSchema: { type: "string" },
  })
  const result = await Effect.runPromise(execute(tool, { count: "41" }, {} as Tool.Context))
  expect(result.output).toBe("42")
})

test("Zod schemas validate, transform, and describe typed tools", async () => {
  const tool: Info = {
    name: "zod",
    description: "Zod tool",
    input: z.object({ count: z.string().transform(Number) }),
    output: z.object({ count: z.number() }),
    execute: ({ count }) => Effect.succeed({ output: { count: count + 1 } }),
  }

  expect(definition(tool)).toEqual({
    name: "zod",
    description: "Zod tool",
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { count: { type: "string" } },
      required: ["count"],
    },
    outputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
      additionalProperties: false,
    },
  })
  expect(await Effect.runPromise(execute(tool, { count: "41" }, {} as Tool.Context))).toMatchObject({
    output: { count: 42 },
  })
  expect(await Effect.runPromise(Effect.flip(execute(tool, { count: 41 }, {} as Tool.Context)))).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "zod":\n- count: Invalid input: expected string, received number\n\nArguments provided:\n{\n  "count": 41\n}\n\nUpdate the arguments and call the tool again.',
    }),
  )
})

test("portable schema failures become tool failures", async () => {
  const input = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (_value: unknown) => ({
        issues: [
          { path: ["value"], message: "expected a string" },
          { path: [{ key: "nested" }, { key: "count" }], message: "expected a positive integer" },
        ],
      }),
      jsonSchema: {
        input: () => ({ type: "string" }),
        output: () => ({ type: "string" }),
      },
    },
  }

  const error = await Effect.runPromise(
    Effect.flip(
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
    ),
  )
  expect(error).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "invalid":\n- value: expected a string\n- nested.count: expected a positive integer\n\nArguments provided:\n1\n\nUpdate the arguments and call the tool again.',
    }),
  )
})

test("Effect schema failures use normalized input issues", async () => {
  const tool: Info = {
    name: "effect",
    description: "Effect tool",
    input: Schema.Struct({
      value: Schema.String,
      nested: Schema.Struct({ count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
    }),
    execute: () => Effect.succeed({ content: "unused" }),
  }

  expect(
    await Effect.runPromise(Effect.flip(execute(tool, { value: 1, nested: { count: 0 } }, {} as Tool.Context))),
  ).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "effect":\n- value: Expected string\n- nested.count: Expected a value greater than or equal to 1\n\nArguments provided:\n{\n  "value": 1,\n  "nested": {\n    "count": 0\n  }\n}\n\nUpdate the arguments and call the tool again.',
    }),
  )
})

test("input error prompts limit normalized issues", async () => {
  const input = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (_value: unknown) => ({
        issues: Array.from({ length: 6 }, (_, index) => ({ message: `issue ${index + 1}` })),
      }),
      jsonSchema: {
        input: () => ({}),
        output: () => ({}),
      },
    },
  }
  const tool: Info = {
    name: "limited",
    description: "Limited issues",
    input,
    execute: () => Effect.succeed({ content: "unused" }),
  }

  expect(await Effect.runPromise(Effect.flip(execute(tool, {}, {} as Tool.Context)))).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "limited":\n- root: issue 1\n- root: issue 2\n- root: issue 3\n- root: issue 4\n- root: issue 5\n- ...and 1 more issue\n\nArguments provided:\n{}\n\nUpdate the arguments and call the tool again.',
    }),
  )
})

test("canonical results carry metadata with typed output", async () => {
  const input = Schema.Struct({ value: Schema.String })
  const output = Schema.Struct({ value: Schema.String, internal: Schema.Boolean })
  const tool: Info = {
    name: "annotated",
    description: "Annotated tool",
    input,
    output,
    execute: ({ value }) => Effect.succeed({ output: { value, internal: true }, metadata: { value }, content: value }),
  }

  expect(await Effect.runPromise(tool.execute({ value: "out" }, {} as Tool.Context))).toEqual({
    output: { value: "out", internal: true },
    metadata: { value: "out" },
    content: "out",
  })
})

test("raw JSON schemas validate and decode tool input", async () => {
  const input = {
    type: "object",
    properties: {
      value: { type: "string" },
      nested: {
        type: "object",
        properties: { count: { type: "integer", minimum: 1 } },
        required: ["count"],
        additionalProperties: false,
      },
    },
    required: ["value"],
    additionalProperties: false,
  }
  const tool: Info = {
    name: "raw",
    description: "Raw tool",
    input,
    execute: (input) => Effect.succeed({ content: JSON.stringify(input) }),
  }

  expect(definition(tool)).toEqual({
    name: "raw",
    description: "Raw tool",
    inputSchema: input,
  })
  expect(await Effect.runPromise(execute(tool, { value: "ok", extra: true }, {} as Tool.Context))).toEqual({
    output: undefined,
    content: [{ type: "text", text: '{"value":"ok"}' }],
  })
  expect(await Effect.runPromise(Effect.flip(execute(tool, { value: 1 }, {} as Tool.Context)))).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "raw":\n- value: Expected string\n\nArguments provided:\n{\n  "value": 1\n}\n\nUpdate the arguments and call the tool again.',
    }),
  )
  expect(await Effect.runPromise(Effect.flip(execute(tool, {}, {} as Tool.Context)))).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "raw":\n- value: Missing key\n\nArguments provided:\n{}\n\nUpdate the arguments and call the tool again.',
    }),
  )
  expect(
    await Effect.runPromise(Effect.flip(execute(tool, { value: "ok", nested: { count: 0 } }, {} as Tool.Context))),
  ).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "raw":\n- nested.count: Expected a value greater than or equal to 1\n\nArguments provided:\n{\n  "value": "ok",\n  "nested": {\n    "count": 0\n  }\n}\n\nUpdate the arguments and call the tool again.',
    }),
  )
  expect(
    await Effect.runPromise(Effect.flip(execute(tool, { value: 1, nested: { count: 0 } }, {} as Tool.Context))),
  ).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "raw":\n- value: Expected string\n- nested.count: Expected a value greater than or equal to 1\n\nArguments provided:\n{\n  "value": 1,\n  "nested": {\n    "count": 0\n  }\n}\n\nUpdate the arguments and call the tool again.',
    }),
  )
})

test("raw JSON schemas resolve draft-07 definitions", async () => {
  const tool: Info = {
    name: "draft-07",
    description: "Draft-07 tool",
    input: {
      type: "object",
      properties: { value: { $ref: "#/definitions/value" } },
      required: ["value"],
      definitions: { value: { type: "string" } },
    },
    execute: (input) => Effect.succeed({ content: JSON.stringify(input) }),
  }

  expect(await Effect.runPromise(execute(tool, { value: "ok" }, {} as Tool.Context))).toMatchObject({
    content: [{ type: "text", text: '{"value":"ok"}' }],
  })
  expect(await Effect.runPromise(Effect.flip(execute(tool, { value: 1 }, {} as Tool.Context)))).toEqual(
    new Tool.Error({
      message:
        'Invalid arguments for tool "draft-07":\n- value: Expected value\n\nArguments provided:\n{\n  "value": 1\n}\n\nUpdate the arguments and call the tool again.',
    }),
  )
})

test("raw JSON schemas pass input through when they cannot be imported", async () => {
  const tool: Info = {
    name: "invalid-schema",
    description: "Invalid schema tool",
    input: {
      type: "object",
      properties: { value: { $ref: "#/$defs/missing" } },
    },
    execute: (input) => Effect.succeed({ content: JSON.stringify(input) }),
  }

  expect(await Effect.runPromise(execute(tool, { value: 1, extra: true }, {} as Tool.Context))).toMatchObject({
    content: [{ type: "text", text: '{"value":1,"extra":true}' }],
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
