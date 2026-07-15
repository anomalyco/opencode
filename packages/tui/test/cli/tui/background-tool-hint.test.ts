import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode-ai/client"
import { backgroundableToolID } from "../../../src/routes/session"

test("shows the hint for running foreground work", () => {
  expect(backgroundableToolID([assistant(tool("subagent"))])).toBe("assistant:subagent")
  expect(backgroundableToolID([assistant(tool("shell"))])).toBe("assistant:shell")
})

test("hides the hint when all running work started in the background", () => {
  expect(backgroundableToolID([assistant(tool("subagent", true), tool("shell", true))])).toBeUndefined()
})

test("shows the hint when foreground work remains alongside background work", () => {
  expect(backgroundableToolID([assistant(tool("subagent", true), tool("shell"))])).toBe("assistant:shell")
})

test("ignores running tools that cannot be backgrounded", () => {
  expect(backgroundableToolID([assistant(tool("read"))])).toBeUndefined()
})

function assistant(...content: SessionMessageAssistantTool[]): SessionMessageAssistant {
  return {
    type: "assistant",
    id: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content,
    time: { created: 1 },
  }
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
