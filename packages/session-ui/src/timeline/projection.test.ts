import { describe, expect, test } from "bun:test"
import type { ModelRef, SessionMessageInfo } from "@opencode-ai/client/promise"
import { createTimelineProjection, reuseTimelineRows, TimelineRow, type PartGroup } from "./projection"

const context = (key: string, partIDs: string[], userMessageID = "user-1") =>
  new TimelineRow.AssistantPart({
    userMessageID,
    group: {
      key,
      type: "context",
      refs: partIDs.map((partID) => ({ messageID: "assistant-1", partID })),
    } satisfies PartGroup,
    previousAssistantPart: false,
  })

const user = (userMessageID = "user-1") => new TimelineRow.UserMessage({ userMessageID })
const keys = (rows: TimelineRow.TimelineRow[]) => rows.map(TimelineRow.key)

describe("reuseTimelineRows", () => {
  test.each([
    {
      name: "reuses an unchanged context group",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [[0, 0]],
    },
    {
      name: "preserves the group key when a member is appended",
      previous: [context("context:a", ["a"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "preserves the group key when the first member is removed",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "lets only the natural owner retain an old key after a split",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a"]), context("context:b", ["b"])],
      expected: ["assistant-part:user-1:context:a", "assistant-part:user-1:context:b"],
      reused: [],
    },
    {
      name: "chooses the earliest prior key when groups merge",
      previous: [context("context:a", ["a"]), context("context:b", ["b"])],
      rows: [context("context:b", ["b", "a"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "reserves an old key for its natural owner when two new groups compete",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"])],
      expected: ["assistant-part:user-1:context:b", "assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "does not reuse context identity across user messages",
      previous: [context("context:a", ["a", "b"], "user-1")],
      rows: [context("context:b", ["b"], "user-2")],
      expected: ["assistant-part:user-2:context:b"],
      reused: [],
    },
    {
      name: "reuses an unaffected ordinary row",
      previous: [user()],
      rows: [user()],
      expected: ["user-message:user-1"],
      reused: [[0, 0]],
    },
    {
      name: "does not create accidental key collisions",
      previous: [context("context:a", ["a", "b", "c"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"]), context("context:c", ["c"])],
      expected: [
        "assistant-part:user-1:context:b",
        "assistant-part:user-1:context:a",
        "assistant-part:user-1:context:c",
      ],
      reused: [],
    },
  ])("$name", ({ previous, rows, expected, reused }) => {
    const result = reuseTimelineRows([...previous], [...rows])

    expect(keys(result)).toEqual([...expected])
    expect(new Set(keys(result)).size).toBe(result.length)
    reused.forEach(([resultIndex, previousIndex]) => expect(result[resultIndex]).toBe(previous[previousIndex]))
  })
})

describe("createTimelineProjection", () => {
  test("builds current message, parent, context, and row indexes", () => {
    const selectedModel = { id: "selected", providerID: "provider" } satisfies ModelRef
    const assistantModel = { id: "assistant", providerID: "provider", variant: "fast" } satisfies ModelRef
    const messages = [
      { id: "agent", type: "agent-switched", agent: "explore", time: { created: 1 } },
      { id: "model", type: "model-switched", model: selectedModel, time: { created: 2 } },
      { id: "user-1", type: "user", text: "first", time: { created: 3 } },
      {
        id: "assistant-1",
        type: "assistant",
        agent: "build",
        model: assistantModel,
        content: [{ type: "text", text: "answer" }],
        time: { created: 4, completed: 5 },
      },
      {
        id: "user-2",
        type: "user",
        text: "second",
        metadata: {
          agent: "review",
          model: { modelID: "override", providerID: "custom", variant: "precise" },
        },
        time: { created: 6 },
      },
    ] satisfies SessionMessageInfo[]

    const result = createTimelineProjection({
      sessionMessages: messages,
      status: { type: "busy" },
      showReasoningSummaries: true,
    })

    expect(result.activeMessageID).toBe("user-2")
    expect(result.messageByID).toBe(result.sessionMessageByID)
    expect(result.sessionMessageByID.get("assistant-1")).toBe(messages[3])
    expect(result.assistantMessagesByParent.get("user-1")?.map((message) => message.id)).toEqual(["assistant-1"])
    expect(result.assistantMessagesByParent.has("user-2")).toBe(false)
    expect(result.userContextByID.get("user-1")).toEqual({ agent: "build", model: assistantModel })
    expect(result.userContextByID.get("user-2")).toEqual({
      agent: "review",
      model: { id: "override", providerID: "custom", variant: "precise" },
    })
    expect(result.messageRowIndex.get("user-1")).toBe(0)
    expect(result.messageLastRowIndex.get("user-1")).toBe(3)
    expect(result.lastAssistantGroupKey.get("user-1")).toBe("part:assistant-1:assistant-1:text:0")
    expect(result.rowByKey.get("user-message:user-1")).toBe(result.rows[2])
  })

  test("reuses a stable projected row array", () => {
    const messages = [
      { id: "user-1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "assistant-1",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "answer" }],
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]
    const first = createTimelineProjection({
      sessionMessages: messages,
      status: { type: "idle" },
      showReasoningSummaries: true,
    })
    const second = createTimelineProjection({
      sessionMessages: messages,
      status: { type: "idle" },
      showReasoningSummaries: true,
      previousRows: first.rows,
    })

    expect(second.rows).toBe(first.rows)
    expect(second.rows[0]).toBe(first.rows[0])
    expect(second.rows[1]).toBe(first.rows[1])
  })
})
