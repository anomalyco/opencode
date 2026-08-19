import { describe, expect, mock, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { PartGroup } from "@opencode-ai/session-ui/message-part"
import type { AssistantMessage, Message, Part, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2"
import { createRoot } from "solid-js"
import {
  redoTarget,
  restoreTarget,
  selectRevertedMessages,
  selectVisibleMessages,
  visiblePartsForMessage,
} from "./revert"
import { reuseTimelineRows } from "./row-reconciliation"
import { TimelineRow } from "./timeline-row"

mock.module("@opencode-ai/session-ui/message-part", () => ({
  renderable: () => true,
  groupParts: (refs: Array<{ messageID: string; part: { id: string } }>) =>
    refs.map((ref) => ({
      type: "part" as const,
      key: ref.part.id,
      ref: { messageID: ref.messageID, partID: ref.part.id },
    })),
}))

const { createTimelineProjection } = await import("./projection")

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

const user = (userMessageID = "user-1") => new TimelineRow.UserMessage({ userMessageID, anchor: true })
const keys = (rows: TimelineRow.TimelineRow[]) => rows.map(TimelineRow.key)
const userMessage = (id: string, created: number) =>
  ({ id, sessionID: "ses_test", role: "user", time: { created } }) as UserMessage
const assistantMessage = (id: string, parentID: string, created: number) =>
  ({ id, parentID, sessionID: "ses_test", role: "assistant", time: { created } }) as AssistantMessage
const textPart = (id: string, messageID: string) =>
  ({ id, messageID, sessionID: "ses_test", type: "text", text: id }) as Extract<Part, { type: "text" }>

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

describe("timeline projection", () => {
  test("does not re-add current-protocol turns after a whole-message revert", () => {
    const u1 = userMessage("u1", 1)
    const a1 = assistantMessage("a1", u1.id, 2)
    const u2 = userMessage("u2", 3)
    const a2 = assistantMessage("a2", u2.id, 4)
    const source = [
      { id: u1.id, type: "user", text: "first", time: { created: 1 } },
      {
        id: a1.id,
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        time: { created: 2, completed: 2 },
      },
      { id: u2.id, type: "user", text: "second", time: { created: 3 } },
      {
        id: a2.id,
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        time: { created: 4, completed: 4 },
      },
    ] satisfies SessionMessageInfo[]
    const rows = createRoot((dispose) => {
      const projection = createTimelineProjection({
        messages: () => [u1, a1, u2, a2],
        userMessages: () => [u1, u2],
        sessionMessages: () => source,
        parts: () => [],
        status: () => ({ type: "idle" }) as SessionStatus,
        showReasoningSummaries: () => true,
        inlineComments: () => true,
        revert: () => ({ messageID: u2.id }),
      })
      const result = projection.rows().map(TimelineRow.key)
      dispose()
      return result
    })

    expect(rows).toEqual(["user-message:u1"])
  })

  test("keeps only the boundary assistant for part-level reverts", () => {
    const messages: Message[] = [
      userMessage("u1", 1),
      assistantMessage("a1", "u1", 2),
      assistantMessage("a2", "u1", 3),
      userMessage("u2", 4),
    ]

    expect(selectVisibleMessages(messages, { messageID: "a1", partID: "p2" }).map((message) => message.id)).toEqual([
      "u1",
      "a1",
    ])
  })

  test("does not guess visibility from IDs when the boundary is not loaded", () => {
    const messages: Message[] = [userMessage("u1", 1), assistantMessage("a1", "u1", 2), userMessage("u3", 4)]

    expect(selectVisibleMessages(messages, { messageID: "u2" })).toEqual([])
  })

  test("uses authoritative array order for equal-timestamp reverse IDs", () => {
    const messages: Message[] = [userMessage("z-user", 1), userMessage("a-user", 1)]

    expect(selectVisibleMessages(messages, { messageID: "a-user" }).map((message) => message.id)).toEqual(["z-user"])
    expect(selectRevertedMessages(messages, { messageID: "a-user" }).map((message) => message.id)).toEqual(["a-user"])
  })

  test("selects redo order from a part-level assistant boundary", () => {
    const messages: Message[] = [
      userMessage("u1", 1),
      assistantMessage("a1", "u1", 2),
      userMessage("u2", 3),
      assistantMessage("a2", "u2", 4),
      userMessage("u3", 5),
    ]

    expect(selectRevertedMessages(messages, { messageID: "a1", partID: "p2" }).map((message) => message.id)).toEqual([
      "a1",
      "u2",
      "u3",
    ])
    expect(selectRevertedMessages(messages, { messageID: "a1" }).map((message) => message.id)).toEqual([
      "a1",
      "u2",
      "u3",
    ])
    expect(selectRevertedMessages(messages, { messageID: "missing" })).toEqual([])
  })

  test("distinguishes unavailable redo state from a terminal clear", () => {
    expect(redoTarget({ ready: false })).toBeUndefined()
    expect(redoTarget({ ready: true, nextMessageID: "u2" })).toBe("u2")
    expect(redoTarget({ ready: true })).toBeNull()
  })

  test("continues a restore from the end of a truncated preview", () => {
    expect(
      restoreTarget(
        {
          items: [{ id: "u1" }, { id: "u2" }],
          continuationMessageID: "u3",
        },
        "u2",
      ),
    ).toBe("u3")
    expect(restoreTarget({ items: [{ id: "u1" }, { id: "u2" }] }, "u2")).toBeNull()
    expect(restoreTarget({ items: [{ id: "u1" }] }, "missing")).toBeUndefined()
  })

  test("trims boundary assistant parts before part-level revert", () => {
    const parts = [textPart("p1", "a1"), textPart("p2", "a1"), textPart("p3", "a1")]

    expect(visiblePartsForMessage("a1", parts, { messageID: "a1", partID: "p2" }).map((part) => part.id)).toEqual([
      "p1",
    ])
    expect(visiblePartsForMessage("a2", parts, { messageID: "a1", partID: "p2" })).toBe(parts)
  })
})
