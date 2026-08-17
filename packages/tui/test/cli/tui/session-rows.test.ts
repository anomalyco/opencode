import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client"
import { cacheReuseDrop, messageBoundaryIDs, reduceSessionRows, turnDuration } from "../../../src/routes/session/rows"

test("measures turn duration from the user prompt across assistant steps", () => {
  const first = assistant("assistant-1", [])
  first.time = { created: 8_000, completed: 11_000 }
  const final = assistant("assistant-2", [])
  final.time = { created: 27_000, completed: 30_000 }
  const messages: SessionMessageInfo[] = [
    { type: "user", id: "user-1", text: "Question", time: { created: 1_000 } },
    first,
    final,
  ]

  expect(turnDuration(final, messages)).toBe(29_000)
})

test("filters OpenAI cache quantization from cache reuse drops", () => {
  const openai = { id: "gpt", providerID: "openai" }
  expect(cacheReuseDrop(undefined, { read: 10_000, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 11_000, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 8_977, model: openai })).toBe(1_023)
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 8_976, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 8_500, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 7_952, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 7_951, model: openai })).toBe(2_049)
})

test("compares cache reuse only for the same model", () => {
  const previous = { read: 10_000, model: { id: "claude", providerID: "anthropic" } }
  expect(cacheReuseDrop(previous, { read: 8_976, model: { id: "gpt", providerID: "openai" } })).toBeUndefined()
  expect(cacheReuseDrop(previous, { read: 8_976, model: { id: "claude", providerID: "anthropic" } })).toBe(1_024)
  expect(
    cacheReuseDrop(
      { read: 10_000, model: { id: "gpt", providerID: "openai", variant: "low" } },
      { read: 8_976, model: { id: "gpt", providerID: "openai", variant: "high" } },
    ),
  ).toBeUndefined()
})

test("carries model identity with the cross-turn cache baseline", () => {
  const first = assistant("assistant-1", [])
  first.model = { id: "claude", providerID: "anthropic" }
  first.finish = "stop"
  first.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 10_000, write: 0 } }
  const second = assistant("assistant-2", [])
  second.model = { id: "gpt", providerID: "openai" }
  second.finish = "stop"
  second.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 8_976, write: 0 } }

  const rows = reduceSessionRows(
    [
      { type: "user", id: "user-1", text: "First", time: { created: 0 } },
      first,
      { type: "user", id: "user-2", text: "Second", time: { created: 2 } },
      second,
    ],
    new Set(),
    true,
  ).filter((row) => row.type === "turn-usage")

  expect(rows).toEqual([
    { type: "turn-usage", messageIDs: ["assistant-1"] },
    {
      type: "turn-usage",
      messageIDs: ["assistant-2"],
      previousCache: { read: 10_000, model: { id: "claude", providerID: "anthropic" } },
    },
  ])
})

test("resets the cross-turn cache baseline after compaction", () => {
  const first = assistant("assistant-1", [])
  first.finish = "stop"
  first.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 370_176, write: 0 } }
  const second = assistant("assistant-2", [])
  second.finish = "stop"
  second.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 13_824, write: 0 } }

  const rows = reduceSessionRows(
    [
      first,
      {
        type: "compaction",
        id: "compaction-1",
        status: "completed",
        reason: "auto",
        summary: "Compacted context",
        recent: "",
        time: { created: 2 },
      },
      second,
    ],
    new Set(),
    true,
  ).filter((row) => row.type === "turn-usage")

  expect(rows).toEqual([
    { type: "turn-usage", messageIDs: ["assistant-1"] },
    { type: "turn-usage", messageIDs: ["assistant-2"] },
  ])
})

test("assigns assistant boundaries to the first rendered row instead of the first text row", () => {
  const messages: SessionMessageInfo[] = [
    { type: "user", id: "user-1", text: "Question", time: { created: 0 } },
    assistant("assistant-1", [
      { type: "reasoning", text: "Thinking" },
      { type: "text", text: "First" },
      { type: "text", text: "Second" },
    ]),
  ]
  const rows = reduceSessionRows(messages)

  expect(messageBoundaryIDs(rows, messages)).toEqual(["user-1", "assistant-1", undefined, undefined])
})

test("groups exploration parts across assistant messages until a delimiter", () => {
  const messages: SessionMessageInfo[] = [
    { type: "user", id: "user-1", text: "Explore", time: { created: 0 } },
    assistant("assistant-1", [
      { type: "text", text: "Looking" },
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 2 } },
      { type: "tool", id: "glob-1", name: "glob", state: pending(), time: { created: 3 } },
    ]),
    assistant("assistant-2", [
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 5 } },
      { type: "text", text: "Done" },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    { type: "message", messageID: "user-1" },
    { type: "part", ref: { messageID: "assistant-1", partID: "text:0" } },
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
    { type: "part", ref: { messageID: "assistant-2", partID: "text:0" } },
  ])
})

test("keeps non-exploration tools as individual part rows", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } },
      { type: "tool", id: "reasoning:0", name: "bash", state: pending(), time: { created: 2 } },
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
    { type: "part", ref: { messageID: "assistant-1", partID: "reasoning:0" } },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      refs: [{ messageID: "assistant-1", partID: "grep-1" }],
    },
  ])
})

test("assigns stable kind ordinals within an assistant message", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "text", text: "First" },
      { type: "reasoning", text: "Think" },
      { type: "text", text: "Second" },
      { type: "reasoning", text: "Check" },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    { type: "part", ref: { messageID: "assistant-1", partID: "text:0" } },
    {
      type: "group",
      kind: "reasoning",
      completed: true,
      refs: [{ messageID: "assistant-1", partID: "reasoning:0" }],
    },
    { type: "part", ref: { messageID: "assistant-1", partID: "text:1" } },
    {
      type: "group",
      kind: "reasoning",
      completed: false,
      refs: [{ messageID: "assistant-1", partID: "reasoning:1" }],
    },
  ])
})

test("groups adjacent reasoning parts until a visible boundary", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "reasoning", text: "First" },
      { type: "reasoning", text: "Second" },
      { type: "text", text: "Visible" },
      { type: "reasoning", text: "Third" },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "reasoning",
      completed: true,
      refs: [
        { messageID: "assistant-1", partID: "reasoning:0" },
        { messageID: "assistant-1", partID: "reasoning:1" },
      ],
    },
    { type: "part", ref: { messageID: "assistant-1", partID: "text:0" } },
    {
      type: "group",
      kind: "reasoning",
      completed: false,
      refs: [{ messageID: "assistant-1", partID: "reasoning:2" }],
    },
  ])
})

test("groups across empty assistant reasoning parts", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "reasoning", text: "Looking" },
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 2 } },
    ]),
    assistant("assistant-2", [
      { type: "reasoning", text: "" },
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "reasoning",
      completed: true,
      refs: [{ messageID: "assistant-1", partID: "reasoning:0" }],
    },
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
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
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
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
    {
      type: "synthetic",
      id: "synthetic-1",
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
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
    {
      type: "synthetic",
      id: "synthetic-1",
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

test("renders a footer for a pre-output retry assistant after replay", () => {
  const message = assistant("assistant-retry", [])
  message.retry = {
    attempt: 2,
    at: 2_000,
    error: { type: "provider.transport", message: "Disconnected" },
  }

  expect(reduceSessionRows([message])).toEqual([{ type: "assistant-footer", messageID: "assistant-retry" }])
})

test("places a running compaction barrier before every queued user message", () => {
  const queued = (id: string, text: string, created: number): SessionMessageInfo => ({
    type: "user",
    id,
    text,
    time: { created },
  })
  const messages: SessionMessageInfo[] = [
    queued("user-before", "Before", 1),
    {
      type: "compaction",
      id: "compaction",
      status: "running",
      reason: "manual",
      summary: "",
      recent: "",
      time: { created: 2 },
    },
    queued("user-after", "After", 3),
  ]

  expect(reduceSessionRows(messages, new Set(["user-before", "user-after"]))).toEqual([
    { type: "message", messageID: "compaction" },
    { type: "message", messageID: "user-before" },
    { type: "message", messageID: "user-after" },
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
  return { status: "streaming" as const, input: "" }
}
