import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import { backgroundableTool } from "../../../src/routes/session"

function part(name: string, background?: boolean): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "tool",
    name,
    state: { status: "running", input: background ? { background: true } : {}, metadata: {} },
    time: { created: 1 },
  }
}

function turn(parts: SessionMessageAssistantTool[], completed?: number): SessionMessageAssistant {
  return {
    id: "msg",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: parts,
    time: { created: 1, ...(completed === undefined ? {} : { completed }) },
  }
}

test("shows the hint for a running foreground subagent", () => {
  const messages = [turn([part("subagent")])]
  expect(backgroundableTool(messages)).toEqual({ key: "msg:tool", started: 1 })
})

test("shows the hint for a running foreground shell", () => {
  const messages = [turn([part("bash")])]
  expect(backgroundableTool(messages)).toEqual({ key: "msg:tool", started: 1 })
})

test("hides the hint when the running tools were launched in the background", () => {
  const messages = [turn([part("subagent", true), part("shell", true)])]
  expect(backgroundableTool(messages)).toBeUndefined()
})

test("hides the hint for a background task tool", () => {
  const messages = [turn([part("task", true)])]
  expect(backgroundableTool(messages)).toBeUndefined()
})

test("shows the hint when background work coexists with running foreground work", () => {
  const messages = [turn([part("subagent", true), part("shell")])]
  expect(backgroundableTool(messages)).toEqual({ key: "msg:tool", started: 1 })
})

test("ignores running tools the shortcut cannot move", () => {
  const messages = [turn([part("read")])]
  expect(backgroundableTool(messages)).toBeUndefined()
})

test("ignores a turn that already completed", () => {
  const messages = [turn([part("shell")], 100)]
  expect(backgroundableTool(messages)).toBeUndefined()
})
