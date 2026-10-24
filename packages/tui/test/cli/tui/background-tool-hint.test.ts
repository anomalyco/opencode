import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { backgroundableTool } from "../../../src/routes/session/index"

test("shows the hint for running foreground work", () => {
  expect(backgroundableTool([assistant(tool("subagent"))])?.key).toBe("assistant:subagent")
  expect(backgroundableTool([assistant(tool("shell"))])?.key).toBe("assistant:shell")
})

test("hides the hint when all running work started in the background", () => {
  expect(backgroundableTool([assistant(tool("subagent", true), tool("shell", true))])).toBeUndefined()
})

test("shows the hint when foreground work remains alongside background work", () => {
  expect(backgroundableTool([assistant(tool("subagent", true), tool("shell"))])?.key).toBe("assistant:shell")
})

test("ignores running tools that cannot be backgrounded", () => {
  expect(backgroundableTool([assistant(tool("read"))])).toBeUndefined()
})

function assistant(...content: SessionMessageAssistantTool[]): SessionMessageInfo {
  return {
    type: "assistant",
    id: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content,
    time: { created: 1 },
  } as SessionMessageAssistant
}

function tool(name: string, background = false): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: name,
    name,
    state: {
      status: "running",
      input: background ? { background: true } : {},
      metadata: {},
    },
    time: { created: 1 },
  }
}
