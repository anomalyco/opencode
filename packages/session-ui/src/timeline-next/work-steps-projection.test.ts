import { describe, expect, test } from "bun:test"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionStatus,
} from "@opencode/client/promise"
import { Predicate } from "effect"
import { createRoot } from "solid-js"
import { timelinePresets } from "../timeline/detail"
import { createTimelineProjection, type TimelineRow } from "../timeline/projection"
import { workStepPolicy, type WorkSteps } from "../timeline/work-steps"
import { createNextTimelineProjection } from "./projection"

const compact = timelinePresets.find((preset) => preset.id === "compact")!.value

const standard = (foldedReplies: WorkSteps["foldedReplies"] = "all"): WorkSteps => ({
  view: "standard",
  collapseTiming: "completion",
  foldedReplies,
})

const detailed = (foldedReplies: WorkSteps["foldedReplies"] = "all"): WorkSteps => ({
  view: "detailed",
  collapseTiming: "completion",
  foldedReplies,
})

const tool = (
  id: string,
  name: string,
  state: SessionMessageAssistantTool["state"] = {
    status: "completed",
    input: {},
    content: [{ type: "text", text: "" }],
    metadata: {},
  },
): SessionMessageAssistantTool => ({
  id,
  type: "tool",
  name,
  state,
  time: { created: 1 },
})

const failedTool = (id: string): SessionMessageAssistantTool =>
  tool(id, "shell", {
    status: "error",
    input: { command: "false" },
    error: { type: "tool.failed", message: "failed" },
    metadata: {},
  })

const reasoning = (text = "Thinking") =>
  ({
    type: "reasoning",
    text,
    time: { created: 1, completed: 2 },
  }) satisfies SessionMessageAssistant["content"][number]

const assistant = (
  id: string,
  content: SessionMessageAssistant["content"],
  fields: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  time: { created: 1, completed: 2 },
  ...fields,
})

const user = (id = "user-1"): SessionMessageInfo => ({
  id,
  type: "user",
  text: "go",
  time: { created: 0 },
})

const alternating: SessionMessageInfo[] = [
  user(),
  assistant("assistant-1", [reasoning(), tool("read-1", "read"), tool("read-2", "read")]),
  assistant("assistant-2", [tool("grep-1", "grep"), { type: "text", text: "Intermediate reply" }]),
  assistant("assistant-3", [tool("read-3", "read"), { type: "text", text: "Final answer" }]),
]

type AssistantEntry = {
  work: boolean
  responseID?: string
  refs: string[]
}

type AssistantPartRow = Extract<TimelineRow.TimelineRow, { _tag: "AssistantPart" }>

type AssistantContextRow = AssistantPartRow & {
  group: Extract<AssistantPartRow["group"], { type: "context" }>
}

type AssistantWorkRow = AssistantContextRow & {
  group: AssistantContextRow["group"] & { work: { responseID: string } }
}

function isAssistantContextRow(row: TimelineRow.TimelineRow): row is AssistantContextRow {
  return Predicate.isTagged(row, "AssistantPart") && row.group.type === "context"
}

function isAssistantWorkRow(row: TimelineRow.TimelineRow): row is AssistantWorkRow {
  return isAssistantContextRow(row) && row.group.work !== undefined
}

function assistantEntries(rows: readonly TimelineRow.TimelineRow[]): AssistantEntry[] {
  const result: AssistantEntry[] = []

  rows.forEach((row) => {
    if (!Predicate.isTagged(row, "AssistantPart")) return

    if (row.group.type === "part") result.push({ work: false, refs: [row.group.ref.partID] })

    if (row.group.type === "context")
      result.push({
        work: row.group.work !== undefined,
        responseID: row.group.work?.responseID,
        refs: row.group.refs.map((ref) => ref.partID),
      })
  })

  return result
}

function currentRows(messages: SessionMessageInfo[], status: SessionStatus, workSteps?: WorkSteps) {
  return createTimelineProjection({
    sessionMessages: messages,
    status,
    reasoningMode: "compact",
    timelineDetail: compact,
    workSteps,
  }).rows
}

function nextRows(messages: SessionMessageInfo[], status: SessionStatus, workSteps?: WorkSteps) {
  return createRoot((dispose) => {
    const projection = createNextTimelineProjection({
      sessionMessages: () => messages,
      status: () => status,
      timelineDetail: () => compact,
      workSteps: workSteps ? () => workSteps : undefined,
    })

    const rows = projection.rows()

    dispose()

    return rows
  })
}

const expectedAlternating: AssistantEntry[] = [
  {
    work: true,
    responseID: "assistant-1",
    refs: ["assistant-1:reasoning:0", "read-1", "read-2", "grep-1"],
  },
  { work: false, refs: ["assistant-2:text:0"] },
  { work: true, responseID: "assistant-3", refs: ["read-3"] },
  { work: false, refs: ["assistant-3:text:0"] },
]

describe("work step projection", () => {
  test.each([
    ["current live", () => currentRows(alternating, { type: "busy" }, standard())],
    ["current settled", () => currentRows(alternating, { type: "idle" }, standard())],
    ["New live", () => nextRows(alternating, { type: "busy" }, standard())],
    ["New settled", () => nextRows(alternating, { type: "idle" }, standard())],
  ] as const)("%s spans consecutive tools across message IDs and stops at text replies", (_, rows) => {
    expect(assistantEntries(rows())).toEqual(expectedAlternating)
  })

  test.each(["all", "final"] as const)(
    "both projections keep intermediate and final text rows in %s reply mode",
    (foldedReplies) => {
      expect(assistantEntries(currentRows(alternating, { type: "idle" }, standard(foldedReplies)))).toEqual(
        expectedAlternating,
      )
      expect(assistantEntries(nextRows(alternating, { type: "idle" }, standard(foldedReplies)))).toEqual(
        expectedAlternating,
      )
    },
  )

  test("detailed live shows thoughts and tools individually, then groups them when settled", () => {
    const live = assistantEntries(currentRows(alternating, { type: "busy" }, detailed()))
    const settled = assistantEntries(currentRows(alternating, { type: "idle" }, detailed()))

    expect(live.every((entry) => !entry.work)).toBe(true)
    expect(live.map((entry) => entry.refs[0])).toEqual([
      "assistant-1:reasoning:0",
      "read-1",
      "read-2",
      "grep-1",
      "assistant-2:text:0",
      "read-3",
      "assistant-3:text:0",
    ])
    expect(settled).toEqual(expectedAlternating)
  })

  test.each(["current", "next"] as const)(
    "%s folds failed calls while questions and turn errors stay independent",
    (timeline) => {
      const messages: SessionMessageInfo[] = [
        user(),
        assistant(
          "assistant-1",
          [
            tool("read-1", "read"),
            tool("question-1", "question"),
            failedTool("failed-1"),
            tool("execute-1", "execute", {
              status: "completed",
              input: {},
              content: [{ type: "text", text: "Partial result" }],
              metadata: { toolCalls: [{ tool: "fetch", status: "error", input: { url: "https://example.com" } }] },
            }),
          ],
          {
            error: { type: "assistant.failed", message: "The step failed" },
          },
        ),
        user("user-2"),
        assistant("assistant-2", [tool("read-2", "read")]),
      ]

      const rows = (timeline === "current" ? currentRows : nextRows)(messages, { type: "idle" }, standard())
      const entries = assistantEntries(rows)

      expect(entries).toEqual([
        { work: true, responseID: "assistant-1", refs: ["read-1"] },
        { work: false, refs: ["question-1"] },
        { work: true, responseID: "assistant-1", refs: ["failed-1", "execute-1"] },
        { work: true, responseID: "assistant-2", refs: ["read-2"] },
      ])
      expect(rows.filter((row) => Predicate.isTagged(row, "UserMessage"))).toHaveLength(2)
      expect(rows.filter((row) => Predicate.isTagged(row, "Error"))).toHaveLength(1)
    },
  )

  test("omitting workSteps preserves the existing projection", () => {
    const current = assistantEntries(currentRows(alternating, { type: "idle" }))
    const next = assistantEntries(nextRows(alternating, { type: "idle" }))

    expect(current.some((entry) => entry.work)).toBe(false)
    expect(next.some((entry) => entry.work)).toBe(false)
  })

  test("history prepends and appended members preserve the work group identity", () => {
    const initial: SessionMessageInfo[] = [user(), assistant("assistant-1", [tool("read-1", "read")])]

    const extended: SessionMessageInfo[] = [
      user("user-old"),
      assistant("assistant-old", [{ type: "text", text: "Earlier answer" }]),
      user(),
      assistant("assistant-1", [tool("read-1", "read"), { type: "text", text: "Bridge" }, tool("grep-1", "grep")]),
    ]

    const first = currentRows(initial, { type: "idle" }, standard())

    const second = createTimelineProjection({
      sessionMessages: extended,
      status: { type: "idle" },
      reasoningMode: "compact",
      timelineDetail: compact,
      workSteps: standard(),
      previousRows: first,
    }).rows

    const firstWork = first.find(isAssistantWorkRow)!

    const extendedWork = second.find(
      (row): row is AssistantContextRow =>
        Predicate.isTagged(row, "AssistantPart") &&
        row.group.type === "context" &&
        row.group.refs[0]?.partID === "read-1",
    )!

    expect(firstWork.group.key).toBe("work:assistant-1:read-1")
    expect(extendedWork.group.key).toBe(firstWork.group.key)
    expect(extendedWork.group.refs.map((ref) => ref.partID)).toEqual(["read-1"])
    expect(second.flatMap((row) => (isAssistantWorkRow(row) ? [row.group.key] : []))).toEqual([
      "work:assistant-1:read-1",
      "work:assistant-1:grep-1",
    ])
  })

  test("New timeline derives the same stable work keys after a history prepend", () => {
    const initial = assistantEntries(
      nextRows([user(), assistant("assistant-1", [tool("read-1", "read")])], { type: "idle" }, standard()),
    )

    const extended = assistantEntries(
      nextRows(
        [
          user("user-old"),
          assistant("assistant-old", [{ type: "text", text: "Earlier answer" }]),
          user(),
          assistant("assistant-1", [tool("read-1", "read"), { type: "text", text: "Bridge" }, tool("grep-1", "grep")]),
        ],
        { type: "idle" },
        standard(),
      ),
    )

    expect(initial[0]).toEqual({ work: true, responseID: "assistant-1", refs: ["read-1"] })
    expect(extended.slice(-3)).toEqual([
      { work: true, responseID: "assistant-1", refs: ["read-1"] },
      { work: false, refs: ["assistant-1:text:0"] },
      { work: true, responseID: "assistant-1", refs: ["grep-1"] },
    ])
  })

  test("work policies keep the four documented grouping modes", () => {
    expect(workStepPolicy(standard()).groupActivity).toBe("always")
    expect(workStepPolicy(detailed()).groupActivity).toBe("completed")
    expect(workStepPolicy({ ...standard(), view: "compact" }).groupActivity).toBe("always")
    expect(workStepPolicy({ ...standard(), view: "verbose" }).groupActivity).toBe("never")
  })
})
