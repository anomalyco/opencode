import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { activitySummary, summarizeActivity } from "../../../src/routes/session/activity-summary"
import {
  append,
  groupRefs,
  messagePath,
  partitionPending,
  partPath,
  type SessionRow,
} from "../../../src/routes/session/grouping/session"
import { reduceSessionRows } from "../../../src/routes/session/rows"

const model = { id: "model", providerID: "provider" }
const tool = (
  id: string,
  name: string,
  status: "completed" | "running" | "error" = "completed",
): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name,
  time: { created: 1, ...(status === "running" ? {} : { completed: 2 }) },
  state:
    status === "running"
      ? { status, input: {}, metadata: {} }
      : status === "error"
        ? { status, input: {}, error: { type: "Fixture", message: "failed" } }
        : { status, input: {}, content: [{ type: "text", text: "ok" }], metadata: {} },
})
const assistant = (
  id: string,
  content: SessionMessageAssistant["content"],
  finish?: "stop",
): SessionMessageAssistant => ({
  type: "assistant",
  id,
  agent: "build",
  model,
  time: { created: 1, completed: 2 },
  ...(finish ? { finish } : {}),
  content,
})
const instruction = (id: string, paths: string[]): SessionMessageInfo => ({
  type: "synthetic",
  id,
  text: "Instructions",
  description: `Loaded ${paths.join(", ")}`,
  metadata: { instruction: { paths } },
  time: { created: 1 },
})

test("reasoning and exploration group at every level; other tools stand alone", () => {
  for (const verbosity of ["medium", "high"] as const) {
    expect(partPath({ type: "reasoning" }, verbosity)).toEqual(["reasoning"])
    expect(partPath({ type: "tool", name: "read" }, verbosity)).toEqual(["exploration"])
  }
})

test("medium and high add web tools to exploration and group instruction loads", () => {
  for (const verbosity of ["medium", "high"] as const) {
    expect(partPath({ type: "tool", name: "webfetch" }, verbosity)).toEqual(["exploration"])
    expect(partPath({ type: "tool", name: "websearch" }, verbosity)).toEqual(["exploration"])
    expect(partPath({ type: "tool", name: "shell" }, verbosity)).toEqual([])
    expect(messagePath(instruction("i", ["AGENTS.md"]), verbosity)).toEqual(["instructions"])
  }
})

test("low wraps tools, thoughts and instruction loads in activity; text and other messages break it", () => {
  expect(partPath({ type: "reasoning" }, "low")).toEqual(["activity", "reasoning"])
  expect(partPath({ type: "tool", name: "read" }, "low")).toEqual(["activity", "exploration"])
  expect(partPath({ type: "tool", name: "shell" }, "low")).toEqual(["activity"])
  expect(partPath({ type: "text" }, "low")).toEqual([])
  expect(messagePath(instruction("i", ["AGENTS.md"]), "low")).toEqual(["activity", "instructions"])
  expect(messagePath({ type: "user", id: "u", text: "hi", time: { created: 1 } }, "low")).toEqual([])
  // Shell/subagent completion notices are ordinary synthetic messages without instruction metadata.
  expect(
    messagePath(
      {
        type: "synthetic",
        id: "s",
        text: "done",
        description: "bun test",
        metadata: { source: "shell" },
        time: { created: 1 },
      },
      "low",
    ),
  ).toEqual([])
})

test("low hydration nests subgroups inside one activity group per run", () => {
  const messages: SessionMessageInfo[] = [
    { type: "user", id: "u", text: "Go", time: { created: 0 } },
    assistant("a", [
      { type: "reasoning", text: "Plan", time: { created: 1, completed: 2 } },
      tool("r1", "read"),
      tool("r2", "grep"),
    ]),
    instruction("i", ["AGENTS.md"]),
    assistant("b", [tool("sh", "shell"), tool("r3", "read"), { type: "text", text: "Done" }], "stop"),
  ]
  const rows = reduceSessionRows(messages, new Set(), false, "low")
  expect(rows.map((row) => (row.type === "group" ? `${row.kind}:${row.size}` : row.type))).toEqual([
    "message",
    "activity:6",
    "part",
    "assistant-footer",
  ])
  const activity = rows[1]
  if (activity.type !== "group") throw new Error("Expected activity")
  expect(activity.children.map((child) => (child.type === "group" ? child.kind : child.entry.type))).toEqual([
    "reasoning",
    "exploration",
    "instructions",
    "part",
    "exploration",
  ])
  expect(activity.completed).toBe(true)
})

test("medium hydration keeps production shape plus instruction groups", () => {
  const messages: SessionMessageInfo[] = [
    assistant("a", [tool("r1", "read"), tool("w1", "webfetch")]),
    instruction("i1", ["AGENTS.md"]),
    instruction("i2", ["packages/tui/AGENTS.md"]),
    assistant("b", [tool("sh", "shell")]),
  ]
  const rows = reduceSessionRows(messages, new Set(), false, "medium")
  expect(rows.map((row) => (row.type === "group" ? `${row.kind}:${row.size}` : row.type))).toEqual([
    "exploration:2",
    "instructions:2",
    "part",
  ])
})

test("live appends under low merge into the open activity group", () => {
  const rows: SessionRow[] = []
  append(rows, { messageID: "a", partID: "reasoning:0" }, { type: "reasoning" }, rows.length, "low")
  append(rows, { messageID: "a", partID: "r1" }, { type: "tool", name: "read" }, rows.length, "low")
  append(rows, { messageID: "b", partID: "sh" }, { type: "tool", name: "shell" }, rows.length, "low")
  append(rows, { messageID: "b", partID: "r2" }, { type: "tool", name: "read" }, rows.length, "low")
  expect(rows).toHaveLength(1)
  const activity = rows[0]
  if (activity.type !== "group") throw new Error("Expected activity")
  expect(activity.kind).toBe("activity")
  expect(activity.size).toBe(4)
  expect(groupRefs(activity).map((ref) => ref.partID)).toEqual(["reasoning:0", "r1", "sh", "r2"])
  append(rows, { messageID: "b", partID: "text:0" }, { type: "text" }, rows.length, "low")
  expect(rows).toHaveLength(2)
  expect(activity.completed).toBe(true)
})

test("permission-blocked tools inside an activity group are tracked as pending without reordering", () => {
  const rows = reduceSessionRows(
    [assistant("a", [tool("r1", "read"), tool("sh", "shell", "running"), tool("r2", "read")])],
    new Set(),
    false,
    "low",
  )
  partitionPending(rows, new Set(["sh"]))
  const activity = rows[0]
  if (activity.type !== "group" || activity.kind !== "activity") throw new Error("Expected activity")
  expect(activity.pending).toEqual([{ messageID: "a", partID: "sh" }])
  expect(groupRefs(activity).map((ref) => ref.partID)).toEqual(["r1", "r2"])
  expect(groupRefs(activity, true).map((ref) => ref.partID)).toEqual(["r1", "sh", "r2"])
})

test("activity summary counts finished work by category", () => {
  const message = assistant("a", [])
  const items = [
    { message, part: { type: "reasoning" as const, text: "t", time: { created: 1, completed: 2 } } },
    { message, part: tool("s1", "shell") },
    { message, part: tool("s2", "bash") },
    { message, part: tool("e1", "edit") },
    { message, part: tool("p1", "apply_patch") },
    { message, part: tool("r1", "read") },
    { message, part: tool("g1", "grep") },
  ]
  expect(activitySummary(items, 2)).toEqual({
    label: "2 commands, 2 edits, 1 thought, 1 read, 1 tool, 2 instructions",
    active: false,
    failed: false,
  })
})

test("running work is active but not counted, and failures are reported", () => {
  const open = { ...assistant("a", []), time: { created: 1 } }
  const summary = activitySummary(
    [
      { message: open, part: { type: "reasoning" as const, text: "t", time: { created: 1 } } },
      { message: open, part: tool("r1", "read", "running") },
      { message: open, part: tool("r2", "read") },
      { message: open, part: tool("x", "custom.check", "error") },
    ],
    0,
  )
  expect(summary).toEqual({ label: "1 read, 1 tool", active: true, failed: true })
})

test("execute counts its finished nested calls instead of itself", () => {
  const message = assistant("a", [])
  const execute: SessionMessageAssistantTool = {
    ...tool("x", "execute"),
    state: {
      status: "completed",
      input: {},
      content: [{ type: "text", text: "done" }],
      metadata: {
        toolCalls: [
          { tool: "read", status: "completed" },
          { tool: "read", status: "completed" },
          { tool: "custom.lookup", status: "error" },
          { tool: "custom.slow", status: "running" },
        ],
      },
    },
  }
  expect(activitySummary([{ message, part: execute }], 0)).toEqual({
    label: "2 reads, 1 tool",
    active: false,
    failed: true,
  })
})

test("activity summary counts distinct instruction files and skips redacted thoughts", () => {
  const messages: SessionMessageInfo[] = [
    assistant("a", [
      { type: "reasoning", text: "[REDACTED]", time: { created: 1, completed: 2 } },
      { type: "reasoning", text: "Plan", time: { created: 1, completed: 2 } },
      tool("r1", "read"),
    ]),
    instruction("i1", ["AGENTS.md", "src/AGENTS.md"]),
    instruction("i2", ["src/AGENTS.md", "docs/AGENTS.md"]),
  ]
  const activity = reduceSessionRows(messages, new Set(), false, "low")[0]
  if (activity.type !== "group") throw new Error("Expected activity")
  const message = (id: string) => messages.find((item) => item.id === id)
  expect(summarizeActivity(activity, message, [], true).label).toBe("1 thought, 1 read, 3 instructions")
})

test("questions stand alone at every level and end an activity run", () => {
  for (const verbosity of ["low", "medium", "high"] as const)
    expect(partPath({ type: "tool", name: "question" }, verbosity)).toEqual([])
  const rows = reduceSessionRows(
    [assistant("a", [tool("r1", "read"), tool("q", "question", "running"), tool("r2", "read")])],
    new Set(),
    false,
    "low",
  )
  expect(rows.map((row) => (row.type === "group" ? row.kind : row.type))).toEqual(["activity", "part", "activity"])
})

test("a thought still streaming counts as finished once a later row closes its group", () => {
  const open = { ...assistant("a", []), time: { created: 1 } }
  const items = [
    { message: open, part: { type: "reasoning" as const, text: "Planning", time: { created: 1 } } },
    { message: open, part: tool("r1", "read") },
  ]
  expect(activitySummary(items, 0)).toEqual({ label: "1 read", active: true, failed: false })
  expect(activitySummary(items, 0, true)).toEqual({ label: "1 thought, 1 read", active: false, failed: false })
})

test("until something finishes, the summary reports the first running entry", () => {
  const open = {
    ...assistant("a", [tool("e1", "edit", "running"), tool("e2", "edit", "running")]),
    time: { created: 1 },
  }
  const activity = reduceSessionRows([open], new Set(), false, "low")[0]
  if (activity.type !== "group") throw new Error("Expected activity")
  const summary = summarizeActivity(activity, () => open, [], false)
  expect(summary.label).toBe("")
  expect(summary.current).toEqual({ type: "part", ref: { messageID: "a", partID: "e1" } })
})

test("a finished execute with no nested calls counts as one tool", () => {
  const message = assistant("a", [])
  expect(activitySummary([{ message, part: tool("x", "execute") }], 0).label).toBe("1 tool")
})
