import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { messageText } from "../../../src/routes/session/dialog-search"

function user(text: string): SessionMessageInfo {
  return { type: "user", id: "user", text, time: { created: 0 } }
}

function assistant(parts: SessionMessageAssistant["content"]): SessionMessageInfo {
  return {
    type: "assistant",
    id: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test" },
    content: parts,
    time: { created: 1 },
  }
}

function shell(command: string, output?: string): SessionMessageInfo {
  return {
    type: "shell",
    id: "shell",
    shellID: "shell-1",
    command,
    status: "exited",
    exit: 0,
    output: output === undefined ? undefined : { output, cursor: 0, size: 0, truncated: false },
    time: { created: 2 },
  }
}

test("returns the user message text", () => {
  expect(messageText(user("hello world"))).toBe("hello world")
})

test("returns assistant text parts joined by newline", () => {
  expect(
    messageText(
      assistant([
        { type: "text", text: "First line" },
        { type: "text", text: "Second line" },
      ]),
    ),
  ).toBe("First line\nSecond line")
})

test("includes assistant reasoning text", () => {
  expect(
    messageText(
      assistant([
        { type: "text", text: "Visible" },
        { type: "reasoning", text: "Hidden reasoning" },
      ]),
    ),
  ).toBe("Visible\nHidden reasoning")
})

test("excludes assistant tool parts from searchable text", () => {
  expect(
    messageText(
      assistant([
        { type: "text", text: "Some text" },
        {
          type: "tool",
          name: "shell",
          id: "tool-1",
          time: { created: 1 },
          state: { status: "completed", input: {}, content: [{ type: "text", text: "" }] },
        },
      ]),
    ),
  ).toBe("Some text")
})

test("returns shell command and output", () => {
  expect(messageText(shell("echo hi", "hi\n"))).toBe("echo hi\nhi\n")
})

test("returns shell command only when there is no output", () => {
  expect(messageText(shell("echo hi"))).toBe("echo hi")
})

test("returns system message text", () => {
  expect(
    messageText({ type: "system", id: "sys", text: "system notice", time: { created: 3 } }),
  ).toBe("system notice")
})

test("returns synthetic message text", () => {
  expect(
    messageText({ type: "synthetic", id: "syn", text: "synthetic notice", time: { created: 4 } }),
  ).toBe("synthetic notice")
})

test("returns skill message text", () => {
  expect(
    messageText({
      type: "skill",
      id: "sk",
      skill: "skill-id",
      name: "skill-name",
      text: "skill did work",
      time: { created: 5 },
    }),
  ).toBe("skill did work")
})

test("returns compaction summary", () => {
  expect(
    messageText({
      type: "compaction",
      id: "cmp",
      status: "completed",
      reason: "auto",
      summary: "summary text",
      time: { created: 6 },
    }),
  ).toBe("summary text")
})

test("returns empty string for messages without searchable text", () => {
  expect(
    messageText({
      type: "idle",
      id: "idle",
      outcome: "succeeded",
      error: { message: "boom", type: "unknown" },
      time: { created: 7 },
    }),
  ).toBe("")
})
