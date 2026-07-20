import { describe, expect, test } from "bun:test"
import { completedToolUpdate, errorToolUpdate, pendingToolCall, runningToolUpdate, toLocations, toToolKind } from "../../src/acp/tool"

describe("acp tools", () => {
  test("maps kinds and locations", () => {
    expect(toToolKind("shell")).toBe("execute")
    expect(toToolKind("edit")).toBe("edit")
    expect(toToolKind("grep")).toBe("search")
    expect(toLocations("read", { filePath: "/tmp/a.ts" })).toEqual([{ path: "/tmp/a.ts" }])
    expect(toLocations("shell", { command: "pwd" }, "/workspace")).toEqual([{ path: "/workspace" }])
  })

  test("builds tool lifecycle updates", () => {
    expect(pendingToolCall({ toolCallId: "call", toolName: "read", state: { input: { filePath: "/tmp/a" } } })).toMatchObject({
      toolCallId: "call",
      status: "pending",
      kind: "read",
    })
    expect(runningToolUpdate({ toolCallId: "call", toolName: "read", state: { input: {} } })).toMatchObject({
      toolCallId: "call",
      status: "in_progress",
    })
    expect(completedToolUpdate({ toolCallId: "call", toolName: "read", input: {}, content: [{ type: "text", text: "done" }], structured: {} })).toMatchObject({
      toolCallId: "call",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "done" } }],
    })
    expect(errorToolUpdate({ toolCallId: "call", toolName: "read", input: {}, content: [], structured: {}, error: "failed" })).toMatchObject({
      toolCallId: "call",
      status: "failed",
    })
  })
})
