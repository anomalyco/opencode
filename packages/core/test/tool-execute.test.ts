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
