import { expect, test } from "bun:test"
import { CodeModeTool } from "@opencode-ai/core/codemode/tool"
import { Tool } from "@opencode-ai/core/tool"
import { execute } from "@opencode-ai/core/tool/runtime"
import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import type { Info } from "@opencode-ai/schema/tool"
import { Effect, Schema } from "effect"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  callID: Tool.CallID.make("call_execute"),
  progress: () => Effect.void,
}

const createCodeMode = (tools: ReadonlyMap<string, Info>) =>
  CodeModeTool.create(tools, (_, tool, input, context) => execute(tool, input, context))

test("execute describes invariant Code Mode behavior", () => {
  expect(createCodeMode(new Map()).description).toBe(
    [
      "Run JavaScript in a confined Code Mode runtime to orchestrate tool calls and compose their results.",
      "Imports, direct filesystem access, and timers are unavailable. Do not use `fetch`; all external access goes through `tools`.",
      "Within `{ code }`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by `search`. Inside `{ code }`, ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
      'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
      "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
      "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.all`.",
    ].join("\n"),
  )
})

test("canonical execution distinguishes declared, model-only, and raw schema outputs", async () => {
  const declared: Info = ({
    name: "declared",
    description: "Declared",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ value: Schema.String }),
    execute: ({ value }) => Effect.succeed({ output: { value } }),
  })
  const modelOnlyInput = Schema.Struct({})
  const modelOnly = ({
    name: "model_only",
    description: "Model only",
    input: modelOnlyInput,
    execute: () => Effect.succeed({ content: "visible only", metadata: { kind: "model" } }),
  }) satisfies Info<typeof modelOnlyInput, undefined>
  const raw: Info = ({
    name: "raw",
    description: "Raw",
    input: {},
    output: {},
    execute: (input) => Effect.succeed({ output: input, content: "raw" }),
  })

  expect(await Effect.runPromise(execute(declared, { value: "encoded" }, context))).toEqual({
    output: { value: "encoded" },
    content: [{ type: "text", text: '{"value":"encoded"}' }],
  })
  expect(await Effect.runPromise(execute(modelOnly, {}, context))).toEqual({
    output: undefined,
    content: [{ type: "text", text: "visible only" }],
    metadata: { kind: "model" },
  })
  expect(await Effect.runPromise(execute(raw, { unchecked: true }, context))).toEqual({
    output: { unchecked: true },
    content: [{ type: "text", text: "raw" }],
  })
})

test("declared outputs cannot bypass validation and raw outputs stay JSON-compatible", async () => {
  const missing: Info = {
    name: "missing",
    description: "Missing output",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed({ content: "not an output" }),
  }
  const invalid: Info = {
    name: "invalid",
    description: "Invalid raw output",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: 1n, content: "not JSON" }),
  }

  expect((await Effect.runPromiseExit(execute(missing, {}, context))).toString()).toContain(
    "Tool did not return its declared output",
  )
  expect((await Effect.runPromiseExit(execute(invalid, {}, context))).toString()).toContain(
    "Tool returned a non-JSON value",
  )
})

test("execute supports callable namespace tools", async () => {
  const callable: Info = ({
    name: "admin",
    description: "Administer Slack",
    input: Schema.Struct({}),
    output: Schema.String,
    options: { namespace: "slack" },
    execute: () => Effect.succeed({ output: "admin" }),
  })
  const child: Info = ({
    name: "create",
    description: "Create a Slack resource",
    input: Schema.Struct({}),
    output: Schema.String,
    options: { namespace: "slack.admin" },
    execute: () => Effect.succeed({ output: "created" }),
  })
  const codeMode = createCodeMode(
    new Map([
      ["slack_admin", callable],
      ["slack_admin_create", child],
    ]),
  )
  const result = await Effect.runPromise(
    codeMode.execute(
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
