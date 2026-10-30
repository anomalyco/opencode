import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { isLandmark, navigationTargets, pickNavigationTarget } from "../../../src/routes/session/navigation"

const sessionID = "ses_test"

function user(id: string): Message {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  }
}

function assistant(id: string): Message {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: "",
    modelID: "test",
    providerID: "test",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function text(id: string, messageID: string, value: string, synthetic?: boolean, ignored?: boolean): Part {
  return { id, sessionID, messageID, type: "text", text: value, synthetic, ignored }
}

function reasoning(id: string, messageID: string, value: string): Part {
  return { id, sessionID, messageID, type: "reasoning", text: value, time: { start: 0, end: 1 } }
}

function tool(id: string, messageID: string, name: string): Part {
  return {
    id,
    sessionID,
    messageID,
    type: "tool",
    callID: id,
    tool: name,
    state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 0, end: 1 } },
  }
}

// Two turns: the first with a GPT-style empty reasoning placeholder, an edit, a
// todo list and two responses; the second with real reasoning, a question and a
// response, followed by a prompt with only synthetic text and one whose text is
// ignored.
const messages = [user("u1"), assistant("a1"), assistant("a2"), user("u2"), assistant("a3"), user("u3"), user("u4")]
const parts: Record<string, Part[]> = {
  u1: [text("u1-text", "u1", "first prompt"), text("u1-synthetic", "u1", "injected", true)],
  a1: [
    reasoning("a1-thinking", "a1", ""),
    reasoning("a1-redacted", "a1", "[REDACTED]"),
    text("a1-text", "a1", "working on it"),
    tool("a1-edit", "a1", "edit"),
    tool("a1-todo", "a1", "todowrite"),
  ],
  a2: [text("a2-blank", "a2", "  \n"), text("a2-text", "a2", "done"), tool("a2-task", "a2", "task")],
  u2: [text("u2-text", "u2", "second prompt")],
  a3: [reasoning("a3-reasoning", "a3", "**Plan** weigh it"), tool("a3-question", "a3", "question")],
  u3: [text("u3-synthetic", "u3", "only synthetic", true)],
  u4: [text("u4-ignored", "u4", "only ignored", false, true)],
}
const lookup = (messageID: string) => parts[messageID] ?? []

describe("session navigation targets", () => {
  test("prompts are user messages with visible, non-ignored text", () => {
    expect([...navigationTargets(messages, lookup, "prompt")]).toEqual(["u1", "u2"])
  })

  test("blocks are prompts, text, reasoning with content and every tool call", () => {
    expect([...navigationTargets(messages, lookup, "block")]).toEqual([
      "u1",
      "a1-text",
      "a1-edit",
      "a1-todo",
      "a2-text",
      "a2-task",
      "u2",
      "a3-reasoning",
      "a3-question",
    ])
  })

  test("landmarks are prompts, the final response of each turn, and questions, todos and subagents", () => {
    expect(new Set(navigationTargets(messages, lookup, "landmark"))).toEqual(
      new Set(["u1", "a1-todo", "a2-task", "a2-text", "u2", "a3-question"]),
    )
  })

  test("the final response of the last turn is a landmark while it is the latest output", () => {
    const streaming = [user("u1"), assistant("a1")]
    const targets = navigationTargets(streaming, (id) => (id === "u1" ? parts.u1 : parts.a1), "landmark")
    expect(new Set(targets)).toEqual(new Set(["u1", "a1-todo", "a1-text"]))
  })
})

describe("landmark entries", () => {
  const targets = navigationTargets(messages, lookup, "landmark")

  test("a part is a landmark by its own ID", () => {
    expect(isLandmark(targets, parts.a2, "a2", "a2-text")).toBe(true)
    expect(isLandmark(targets, parts.a2, "a2", "a2-blank")).toBe(false)
    expect(isLandmark(targets, parts.a3, "a3", "a3-reasoning")).toBe(false)
  })

  test("a message-level entry is a landmark when the message or one of its parts is", () => {
    expect(isLandmark(targets, parts.u1, "u1")).toBe(true)
    expect(isLandmark(targets, parts.a1, "a1")).toBe(true)
    expect(isLandmark(targets, parts.a3, "a3")).toBe(true)
    expect(isLandmark(targets, parts.u3, "u3")).toBe(false)
    expect(isLandmark(targets, [reasoning("a4-reasoning", "a4", "x")], "a4")).toBe(false)
  })
})

describe("session navigation pick", () => {
  const blocks = [
    { id: "a", y: 2 },
    { id: "b", y: 10 },
    { id: "b", y: 14 },
    { id: "c", y: 20 },
  ]

  test("next is the nearest block below the anchor", () => {
    expect(pickNavigationTarget(blocks, 2, "next")).toEqual({ id: "b", y: 10 })
    expect(pickNavigationTarget(blocks, 11, "next")).toEqual({ id: "c", y: 20 })
  })

  test("previous is the nearest block above the anchor, at its first box", () => {
    expect(pickNavigationTarget(blocks, 20, "prev")).toEqual({ id: "b", y: 10 })
    expect(pickNavigationTarget(blocks, 10, "prev")).toEqual({ id: "a", y: 2 })
  })

  test("nothing past either end", () => {
    expect(pickNavigationTarget(blocks, 20, "next")).toBeUndefined()
    expect(pickNavigationTarget(blocks, 2, "prev")).toBeUndefined()
    expect(pickNavigationTarget([], 0, "next")).toBeUndefined()
  })
})
