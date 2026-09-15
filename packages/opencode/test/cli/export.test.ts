import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { usage, usageCsv } from "../../src/cli/cmd/export"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function finish(input: number, output: number, read: number, write: number, reasoning = 0): SessionV1.StepFinishPart {
  return {
    id: PartID.ascending(),
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    type: "step-finish",
    reason: "stop",
    cost: 0.25,
    tokens: { input, output, reasoning, cache: { read, write } },
  }
}

function tool(tool: string, status: "completed" | "error"): SessionV1.ToolPart {
  return {
    id: PartID.ascending(),
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    type: "tool",
    callID: "call_test",
    tool,
    state:
      status === "completed"
        ? { status, input: {}, output: "ok", title: "done", metadata: {}, time: { start: 1, end: 2 } }
        : { status, input: {}, error: "failed", metadata: {}, time: { start: 1, end: 2 } },
  }
}

const session = {
  id: SessionID.make("ses_test"),
  time: { created: 1, updated: 2 },
}

describe("usage export", () => {
  test("sums provider steps without adding tokens.total or message aggregates", () => {
    const first = finish(100, 20, 50, 5, 10)
    first.tokens.total = 999_999
    const messages = [
      {
        info: {
          role: "assistant" as const,
          providerID: "test",
          modelID: "model",
          time: { created: 1, completed: 2 },
        },
        parts: [first, finish(80, 15, 60, 0, 5), tool("graphify_query_graph", "completed")],
      },
    ]

    const report = usage(session, messages)

    expect(report.tokens).toEqual({
      input: 180,
      output: 35,
      reasoning: 15,
      cache: { read: 110, write: 5 },
      processed: 345,
    })
    expect(report.cost).toBe(0.5)
    expect(report.models).toEqual([
      {
        model: "test/model",
        steps: 2,
        cost: 0.5,
        tokens: { input: 180, output: 35, reasoning: 15, cache: { read: 110, write: 5 }, processed: 345 },
      },
    ])
    expect(report.tools).toEqual([{ tool: "graphify_query_graph", calls: 1, completed: 1, errors: 0 }])
  })

  test("reports incomplete messages and child-session scope", () => {
    const report = usage({ ...session, parentID: SessionID.make("ses_parent") }, [
      {
        info: { role: "assistant", providerID: "test", modelID: "model", time: { created: 1 } },
        parts: [tool("read", "error")],
      },
    ])

    expect(report.includesChildren).toBe(false)
    expect(report.parentID).toBe(SessionID.make("ses_parent"))
    expect(report.unfinishedAssistantMessages).toBe(1)
    expect(report.assistantMessagesWithoutUsage).toBe(1)
    expect(report.tools).toEqual([{ tool: "read", calls: 1, completed: 0, errors: 1 }])
  })

  test("emits one safely escaped CSV row", () => {
    const report = usage(session, [
      {
        info: { role: "assistant", providerID: "=provider", modelID: "model,one", time: { created: 1, completed: 2 } },
        parts: [finish(1, 2, 3, 4), tool("graphify_query_graph", "completed")],
      },
    ])

    const output = usageCsv(report)

    expect(output.split("\n")).toHaveLength(3)
    expect(output).toContain('"\'=provider/model,one"')
    expect(output).toContain('"[{""tool""')
  })
})
