import { expect, test } from "bun:test"
import type { AssistantMessage, Message, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"
import { subagentDuration } from "../src/routes/session"

let nextID = 0

function userMessage(created: number): UserMessage {
  return {
    id: `msg_u${nextID++}`,
    sessionID: "ses_test",
    role: "user",
    time: { created },
    agent: "subagent",
    model: { providerID: "test", modelID: "test" },
  }
}

function assistantMessage(created: number, completed?: number): AssistantMessage {
  return {
    id: `msg_a${nextID++}`,
    sessionID: "ses_test",
    role: "assistant",
    time: { created, completed },
    parentID: "msg_parent",
    modelID: "test",
    providerID: "test",
    mode: "build",
    agent: "subagent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function completedState(start: number, end: number): ToolPart["state"] {
  return {
    status: "completed",
    input: {},
    output: "",
    title: "",
    metadata: {},
    time: { start, end },
  }
}

test("uses the tool part time range for completed subagents", () => {
  const messages: Message[] = []
  expect(subagentDuration(completedState(1_000_000, 1_000_000 + 3_660_000), messages)).toBe(3_660_000)
})

test("prefers tool part time over the message scan when both are available", () => {
  const messages: Message[] = [userMessage(1_000), assistantMessage(2_000, 60_000)]
  expect(subagentDuration(completedState(10_000, 42_000), messages)).toBe(32_000)
})

test("falls back to the message scan when the part has no completed time", () => {
  const state: ToolPart["state"] = {
    status: "running",
    input: {},
    title: "",
    time: { start: 1_000 },
  }
  const messages: Message[] = [userMessage(1_000), assistantMessage(2_000, 61_000)]
  expect(subagentDuration(state, messages)).toBe(60_000)
})

test("returns 0 when the first user message fell out of the synced window and no part time exists", () => {
  const state: ToolPart["state"] = {
    status: "running",
    input: {},
    title: "",
    time: { start: 1_000 },
  }
  const messages: Message[] = Array.from({ length: 100 }, (_, index) => assistantMessage(index, index + 1))
  expect(messages.find((x) => x.role === "user")).toBeUndefined()
  expect(subagentDuration(state, messages)).toBe(0)
})
