import { expect, test } from "bun:test"
import { ExecuteTool } from "@opencode-ai/core/tool/execute"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, Schema } from "effect"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  callID: "call_execute",
  progress: () => Effect.void,
}

test("canonical execution distinguishes declared, model-only, and raw schema outputs", async () => {
  const declared = Tool.make({
    description: "Declared",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ value: Schema.String }),
    execute: ({ value }) => Effect.succeed({ output: { value } }),
  })
  const modelOnly = Tool.make({
    description: "Model only",
    input: Schema.Struct({}),
    execute: () => Effect.succeed({ content: "visible only", metadata: { kind: "model" } }),
  })
  const raw = Tool.make({
    description: "Raw",
    input: {},
    output: {},
    execute: (input) => Effect.succeed({ output: input, content: "raw" }),
  })

  expect(await Effect.runPromise(Tool.execute(declared, { value: "encoded" }, context))).toEqual({
    output: { value: "encoded" },
    content: [{ type: "text", text: '{"value":"encoded"}' }],
  })
  expect(await Effect.runPromise(Tool.execute(modelOnly, {}, context))).toEqual({
    content: [{ type: "text", text: "visible only" }],
    metadata: { kind: "model" },
  })
  expect(await Effect.runPromise(Tool.execute(raw, { unchecked: true }, context))).toEqual({
    output: { unchecked: true },
    content: [{ type: "text", text: "raw" }],
  })
})

test("declared outputs cannot bypass validation and raw outputs stay JSON-compatible", async () => {
  const missing: Tool.Any = {
    description: "Missing output",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed({ content: "not an output" }),
  }
  const invalid: Tool.Any = {
    description: "Invalid raw output",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: 1n, content: "not JSON" }),
  }

  expect((await Effect.runPromiseExit(Tool.execute(missing, {}, context))).toString()).toContain(
    "Tool did not return its declared output",
  )
  expect((await Effect.runPromiseExit(Tool.execute(invalid, {}, context))).toString()).toContain(
    "Tool returned a non-JSON value",
  )
})

test("execute preserves successful results with visible unhandled rejections", async () => {
  const child = Tool.make({
    description: "Always fail",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.fail(new Tool.Failure({ message: "Lookup refused" })),
  })
  const execute = ExecuteTool.create(new Map([["fail", { tool: child, name: "fail", permission: "fail" }]]))
  const result = await Effect.runPromise(Tool.execute(execute, { code: `tools.fail({}); return "done"` }, context))

  expect(result.metadata).toEqual({ toolCalls: [{ tool: "fail", status: "error" }] })
  expect(result.content).toEqual([
    {
      type: "text",
      text: [
        "done",
        "",
        "Warnings:",
        "- [ToolFailure] Unhandled rejection from an un-awaited promise: Lookup refused",
      ].join("\n"),
    },
  ])
})

test("execute supports callable namespace tools", async () => {
  const callable = Tool.make({
    description: "Administer Slack",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed({ output: "admin" }),
  })
  const child = Tool.make({
    description: "Create a Slack resource",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed({ output: "created" }),
  })
  const execute = ExecuteTool.create(
    new Map([
      ["slack_admin", { tool: callable, name: "admin", namespace: "slack", permission: "slack_admin" }],
      [
        "slack_admin_create",
        { tool: child, name: "create", namespace: "slack.admin", permission: "slack_admin_create" },
      ],
    ]),
  )
  const result = await Effect.runPromise(
    Tool.execute(
      execute,
      { code: "return [await tools.slack.admin({}), await tools.slack.admin.create({})]" },
      context,
    ),
  )

  expect(result.metadata).toEqual({
    toolCalls: [
      { tool: "slack.admin", status: "completed" },
      { tool: "slack.admin.create", status: "completed" },
    ],
  })
  expect(result.content).toEqual([{ type: "text", text: '[\n  "admin",\n  "created"\n]' }])
})
