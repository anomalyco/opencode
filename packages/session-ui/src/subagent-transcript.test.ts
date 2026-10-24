import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import {
  partBackgrounded,
  scanSubagentTranscript,
  taskStatus,
  text,
  toolAgent,
  toolDescription,
  toolSessionID,
} from "./subagent-transcript"

function tool(
  state: SessionMessageAssistantTool["state"],
  overrides?: Partial<Pick<SessionMessageAssistantTool, "id" | "name">>,
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "part-1",
    name: "subagent",
    time: { created: 1 },
    state,
    ...overrides,
  }
}

function assistant(parts: SessionMessageAssistantTool[], id = "message-1") {
  return {
    id,
    type: "assistant" as const,
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: parts,
    time: { created: 1 },
  }
}

function completedMessage(parts: SessionMessageAssistantTool[]) {
  return { ...assistant(parts), time: { created: 1, completed: 2 } }
}

describe("text", () => {
  test("keeps trimmed strings and drops everything else", () => {
    expect(text("  hello  ")).toBe("hello")
    expect(text("   ")).toBeUndefined()
    expect(text(3)).toBeUndefined()
    expect(text(undefined)).toBeUndefined()
  })
})

describe("taskStatus", () => {
  test("running and streaming parts are running", () => {
    expect(taskStatus(tool({ status: "running", input: {}, metadata: {} }))).toBe("running")
    expect(taskStatus(tool({ status: "streaming", input: "..." }))).toBe("running")
  })
  test("completed parts are completed", () => {
    expect(taskStatus(tool({ status: "completed", input: {}, content: [{ type: "text", text: "done" }] }))).toBe(
      "completed",
    )
  })
  test("aborted errors are cancelled", () => {
    expect(taskStatus(tool({ status: "error", input: {}, error: { type: "aborted", message: "stopped" } }))).toBe(
      "cancelled",
    )
  })
  test("interrupted metadata is cancelled", () => {
    expect(
      taskStatus(
        tool({
          status: "error",
          input: {},
          error: { type: "failed", message: "x" },
          metadata: { interrupted: true },
        }),
      ),
    ).toBe("cancelled")
  })
  test("other errors are errors", () => {
    expect(taskStatus(tool({ status: "error", input: {}, error: { type: "failed", message: "boom" } }))).toBe("error")
  })
})

describe("partBackgrounded", () => {
  test("completed parts with a running metadata status are backgrounded", () => {
    expect(
      partBackgrounded(
        tool({
          status: "completed",
          input: {},
          content: [{ type: "text", text: "x" }],
          metadata: { status: "running" },
        }),
      ),
    ).toBe(true)
    expect(partBackgrounded(tool({ status: "completed", input: {}, content: [{ type: "text", text: "x" }] }))).toBe(
      false,
    )
    expect(partBackgrounded(tool({ status: "running", input: {}, metadata: {} }))).toBe(false)
  })
})

describe("toolSessionID", () => {
  test("reads sessionID then the legacy sessionId spelling", () => {
    expect(toolSessionID(tool({ status: "running", input: {}, metadata: { sessionID: "child-1" } }))).toBe("child-1")
    expect(toolSessionID(tool({ status: "running", input: {}, metadata: { sessionId: "child-2" } }))).toBe("child-2")
  })
  test("missing and blank ids are undefined", () => {
    expect(toolSessionID(tool({ status: "streaming", input: "..." }))).toBeUndefined()
    expect(toolSessionID(tool({ status: "running", input: {}, metadata: { sessionID: "  " } }))).toBeUndefined()
  })
})

describe("toolDescription", () => {
  test("reads descriptions and agent names", () => {
    const part = tool({
      status: "running",
      input: { description: "Explore", agent: "general" },
      metadata: { sessionID: "child" },
    })

    expect(toolDescription(part)).toBe("Explore")
    expect(toolAgent(part)).toBe("general")
    expect(toolDescription(tool({ status: "streaming", input: "..." }))).toBeUndefined()
  })
})

describe("scanSubagentTranscript", () => {
  test("collects calls with child, liveness and backgrounded flags", () => {
    const live = tool({ status: "running", input: { description: "Live" }, metadata: { sessionID: "a" } }, { id: "a" })

    const done = tool(
      {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "done" }],
        metadata: { sessionID: "b", status: "running" },
      },
      { id: "b" },
    )

    const scan = scanSubagentTranscript([completedMessage([]), assistant([live, done], "message-2")])

    expect(scan.calls.map((call) => [call.partID, call.childID, call.live, call.backgrounded])).toEqual([
      ["a", "a", true, false],
      ["b", "b", true, true],
    ])
    expect(scan.completed.size).toBe(0)
    expect(scan.live?.id).toBe("message-2")
  })
  test("stale running parts outside the live message stay out", () => {
    const stale = tool({ status: "running", input: {}, metadata: { sessionID: "old" } })
    const scan = scanSubagentTranscript([completedMessage([stale]), assistant([])])

    expect(scan.calls.map((call) => [call.childID, call.live])).toEqual([["old", false]])
  })
  test("synthetic notices expire backgrounded calls", () => {
    const backgrounded = tool(
      {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "done" }],
        metadata: { sessionID: "child", status: "running" },
      },
      { id: "a" },
    )

    const notice = {
      id: "n1",
      type: "synthetic",
      metadata: { source: "subagent", childID: "child" },
      text: "",
      time: { created: 2 },
    } as const

    const scan = scanSubagentTranscript([completedMessage([backgrounded]), notice])

    expect(scan.completed.has("child")).toBe(true)
    expect(scan.calls.map((call) => call.childID)).toEqual(["child"])
  })
  test("legacy task parts join when asked", () => {
    const legacy = tool({ status: "running", input: {}, metadata: { sessionID: "old" } }, { name: "task" })

    expect(scanSubagentTranscript([assistant([legacy])]).calls).toHaveLength(1)
    expect(scanSubagentTranscript([assistant([legacy])], ["subagent"]).calls).toHaveLength(0)
  })
})
