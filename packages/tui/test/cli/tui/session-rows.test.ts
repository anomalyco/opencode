import { expect, test } from "bun:test"
import type { SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2"
import { reduceSessionRows } from "../../../src/routes/session/rows"

test("groups exploration parts across assistant messages until a delimiter", () => {
  const messages: SessionMessage[] = [
    { type: "user", id: "user-1", text: "Explore", time: { created: 0 } },
    assistant("assistant-1", [
      { type: "text", id: "text-1", text: "Looking" },
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 2 } },
      { type: "tool", id: "glob-1", name: "glob", state: pending(), time: { created: 3 } },
    ]),
    assistant("assistant-2", [
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 5 } },
      { type: "text", id: "text-2", text: "Done" },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    { type: "message", messageID: "user-1" },
    { type: "part", ref: { messageID: "assistant-1", partID: "text-1" } },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      refs: [
        { messageID: "assistant-1", partID: "read-1" },
        { messageID: "assistant-1", partID: "glob-1" },
        { messageID: "assistant-2", partID: "grep-1" },
      ],
    },
    { type: "part", ref: { messageID: "assistant-2", partID: "text-2" } },
  ])
})

test("keeps non-exploration tools as individual part rows", () => {
  const messages: SessionMessage[] = [
    assistant("assistant-1", [
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } },
      { type: "tool", id: "bash-1", name: "bash", state: pending(), time: { created: 2 } },
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      refs: [{ messageID: "assistant-1", partID: "read-1" }],
    },
    { type: "part", ref: { messageID: "assistant-1", partID: "bash-1" } },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      refs: [{ messageID: "assistant-1", partID: "grep-1" }],
    },
  ])
})

test("groups across empty assistant reasoning parts", () => {
  const messages: SessionMessage[] = [
    assistant("assistant-1", [
      { type: "reasoning", id: "reasoning-1", text: "Looking" },
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 2 } },
    ]),
    assistant("assistant-2", [
      { type: "reasoning", id: "reasoning-2", text: "" },
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    { type: "part", ref: { messageID: "assistant-1", partID: "reasoning-1" } },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      refs: [
        { messageID: "assistant-1", partID: "read-1" },
        { messageID: "assistant-2", partID: "grep-1" },
      ],
    },
  ])
})

test("completes exploration groups when another row follows", () => {
  const finished = assistant("assistant-2", [
    { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } },
  ])
  finished.finish = "stop"
  const messages: SessionMessage[] = [
    assistant("assistant-1", [
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } },
    ]),
    { type: "user", id: "user-1", text: "Continue", time: { created: 2 } },
    finished,
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      refs: [{ messageID: "assistant-1", partID: "read-1" }],
    },
    { type: "message", messageID: "user-1" },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      refs: [{ messageID: "assistant-2", partID: "grep-1" }],
    },
    { type: "assistant-footer", messageID: "assistant-2" },
  ])
})

test("hides synthetic messages without descriptions", () => {
  const messages: SessionMessage[] = [
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
    {
      type: "synthetic",
      id: "synthetic-1",
      sessionID: "session-1",
      text: "internal context",
      time: { created: 2 },
    },
    assistant("assistant-2", [{ type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } }]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      refs: [
        { messageID: "assistant-1", partID: "read-1" },
        { messageID: "assistant-2", partID: "grep-1" },
      ],
    },
  ])
})

test("renders synthetic messages with descriptions", () => {
  const messages: SessionMessage[] = [
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
    {
      type: "synthetic",
      id: "synthetic-1",
      sessionID: "session-1",
      text: "internal context",
      description: "Explicit notice",
      time: { created: 2 },
    },
    assistant("assistant-2", [{ type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } }]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      refs: [{ messageID: "assistant-1", partID: "read-1" }],
    },
    { type: "message", messageID: "synthetic-1" },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      refs: [{ messageID: "assistant-2", partID: "grep-1" }],
    },
  ])
})

function assistant(id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant {
  return {
    type: "assistant",
    id,
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content,
    time: { created: 1 },
  }
}

function pending() {
  return { status: "pending" as const, input: "" }
}
