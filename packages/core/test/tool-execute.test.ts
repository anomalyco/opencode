import { expect, test } from "bun:test"
import { ExecuteTool } from "@opencode-ai/core/tool/execute"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, Schema } from "effect"

test("execute preserves successful results with visible unhandled rejections", async () => {
  const child = Tool.make({
    description: "Always fail",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.fail(new Tool.Failure({ message: "Lookup refused" })),
  })
  const execute = ExecuteTool.create(new Map([["fail", { tool: child, name: "fail" }]]))
  const result = await Effect.runPromise(
    Tool.settle(
      execute,
      {
        type: "tool-call",
        id: "call_execute",
        name: "execute",
        input: { code: `tools.fail({}); return "done"` },
      },
      {
        sessionID: Session.ID.make("ses_execute"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_execute"),
        callID: "call_execute",
        progress: () => Effect.void,
      },
    ),
  )

  expect(result.structured).toEqual({ toolCalls: [{ tool: "fail", status: "error" }] })
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
    execute: () => Effect.succeed("admin"),
  })
  const child = Tool.make({
    description: "Create a Slack resource",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed("created"),
  })
  const execute = ExecuteTool.create(
    new Map([
      ["slack_admin", { tool: callable, name: "admin", namespace: "slack" }],
      ["slack_admin_create", { tool: child, name: "create", namespace: "slack.admin" }],
    ]),
  )
  const result = await Effect.runPromise(
    Tool.settle(
      execute,
      {
        type: "tool-call",
        id: "call_execute",
        name: "execute",
        input: { code: "return [await tools.slack.admin({}), await tools.slack.admin.create({})]" },
      },
      {
        sessionID: Session.ID.make("ses_execute"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_execute"),
        callID: "call_execute",
        progress: () => Effect.void,
      },
    ),
  )

  expect(result.structured).toEqual({
    toolCalls: [
      { tool: "slack.admin", status: "completed" },
      { tool: "slack.admin.create", status: "completed" },
    ],
  })
  expect(result.content).toEqual([{ type: "text", text: '[\n  "admin",\n  "created"\n]' }])
})

test("execute exposes typed internal output instead of the persisted receipt", async () => {
  const child = Tool.make({
    description: "Fetch content",
    input: Schema.Struct({}),
    output: Schema.Struct({ content: Schema.String, bytes: Schema.Number }),
    structured: Schema.Struct({ bytes: Schema.Number }),
    codeModeOutput: "output",
    toStructuredOutput: ({ output }) => ({ bytes: output.bytes }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.content }],
    execute: () => Effect.succeed({ content: "full payload", bytes: 12 }),
  })
  const execute = ExecuteTool.create(new Map([["fetch", { tool: child, name: "fetch" }]]))
  const result = await Effect.runPromise(
    Tool.settle(
      execute,
      {
        type: "tool-call",
        id: "call_execute",
        name: "execute",
        input: { code: "return (await tools.fetch({})).content" },
      },
      {
        sessionID: Session.ID.make("ses_execute"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_execute"),
        callID: "call_execute",
        progress: () => Effect.void,
      },
    ),
  )

  expect(result.structured).toEqual({ toolCalls: [{ tool: "fetch", status: "completed" }] })
  expect(result.content).toEqual([{ type: "text", text: "full payload" }])
})

test("execute keeps the structured projection unless a tool opts into internal output", async () => {
  const child = Tool.make({
    description: "Fetch content",
    input: Schema.Struct({}),
    output: Schema.Struct({ content: Schema.String, bytes: Schema.Number }),
    structured: Schema.Struct({ bytes: Schema.Number }),
    toStructuredOutput: ({ output }) => ({ bytes: output.bytes }),
    execute: () => Effect.succeed({ content: "internal", bytes: 8 }),
  })
  const execute = ExecuteTool.create(new Map([["fetch", { tool: child, name: "fetch" }]]))
  const result = await Effect.runPromise(
    Tool.settle(
      execute,
      {
        type: "tool-call",
        id: "call_execute",
        name: "execute",
        input: { code: "return await tools.fetch({})" },
      },
      {
        sessionID: Session.ID.make("ses_execute"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_execute"),
        callID: "call_execute",
        progress: () => Effect.void,
      },
    ),
  )

  expect(result.content).toEqual([{ type: "text", text: '{\n  "bytes": 8\n}' }])
})
