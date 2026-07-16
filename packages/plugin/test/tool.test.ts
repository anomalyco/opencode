import { expect, test } from "bun:test"
import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, Schema } from "effect"
import * as Tool from "../src/v2/effect/tool"

const context = {
  sessionID: Session.ID.make("ses_test"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_test"),
  callID: "call_test",
  progress: () => Effect.void,
} satisfies Tool.Context

test("tools remain valid across separate module instances", async () => {
  const ForeignTool = await import(`${new URL("../src/v2/effect/tool.ts", import.meta.url).href}?foreign`)
  const config = {
    description: "Foreign tool",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ ok: Schema.Boolean }),
    execute: () => Effect.succeed({ ok: true }),
  }
  const tool = ForeignTool.make(config)

  expect(Tool.definition("foreign", tool)).toEqual({
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
  expect(await Effect.runPromise(Tool.settle(tool, { input: { value: "input" } }, context))).toEqual({
    structured: { ok: true },
    content: [],
  })
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
    execute: ({ count }) => Effect.succeed(count + 1),
  })

  expect(Tool.definition("portable", tool)).toEqual({
    name: "portable",
    description: "Portable tool",
    inputSchema: { type: "object", properties: { count: { type: "string" } } },
    outputSchema: { type: "string" },
  })
  expect(await Effect.runPromise(Tool.settle(tool, { input: { count: "41" } }, context))).toEqual({
    structured: "42",
    content: [{ type: "text", text: "42" }],
  })
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
  const tool = Tool.make({
    description: "Failing tool",
    input,
    output: input,
    execute: Effect.succeed,
  })

  const error = await Effect.runPromiseExit(Tool.settle(tool, { input: 1 }, context))
  expect(error.toString()).toContain("Invalid tool input: expected a string")
})

test("two-parameter Definition annotations retain their original meaning", () => {
  const input = Schema.Struct({ value: Schema.String })
  const output = Schema.Struct({ value: Schema.String, internal: Schema.Boolean })
  const structured = Schema.Struct({ value: Schema.String })
  const tool: Tool.Definition<typeof input, typeof structured> = Tool.make({
    description: "Annotated tool",
    input,
    output,
    structured,
    toStructuredOutput: ({ output }) => ({ value: output.value }),
    execute: ({ value }) => Effect.succeed({ value, internal: true }),
  })

  expect(tool.structured).toBe(structured)
})
