import { describe, expect, test } from "bun:test"
import { Equal } from "effect"
import { TimelineRow, type SummaryDiff } from "./timeline-row"

const diff = (file: string, patch: string): SummaryDiff => ({
  file,
  patch,
  additions: 1,
  deletions: 0,
  status: "modified",
})

const rows: TimelineRow.TimelineRow[] = [
  new TimelineRow.TurnGap({ userMessageID: "msg_1" }),
  new TimelineRow.TurnGap({ userMessageID: "msg_2" }),
  new TimelineRow.CommentStrip({ userMessageID: "msg_1" }),
  new TimelineRow.UserMessage({ userMessageID: "msg_1", anchor: true }),
  new TimelineRow.UserMessage({ userMessageID: "msg_1", anchor: false }),
  new TimelineRow.UserMessage({ userMessageID: "msg_2", anchor: true }),
  new TimelineRow.TurnDivider({ userMessageID: "msg_1", label: "compaction" }),
  new TimelineRow.TurnDivider({ userMessageID: "msg_1", label: "interrupted" }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_1",
    previousAssistantPart: false,
    group: { key: "grp_1", type: "part", ref: { messageID: "msg_1", partID: "part_1" } },
  }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_1",
    previousAssistantPart: false,
    group: { key: "grp_1", type: "part", ref: { messageID: "msg_1", partID: "part_2" } },
  }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_1",
    previousAssistantPart: true,
    group: { key: "grp_1", type: "part", ref: { messageID: "msg_1", partID: "part_1" } },
  }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_1",
    previousAssistantPart: false,
    group: {
      key: "grp_2",
      type: "context",
      refs: [
        { messageID: "msg_1", partID: "part_1" },
        { messageID: "msg_1", partID: "part_2" },
      ],
    },
  }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_1",
    previousAssistantPart: false,
    group: {
      key: "grp_2",
      type: "context",
      refs: [
        { messageID: "msg_1", partID: "part_2" },
        { messageID: "msg_1", partID: "part_1" },
      ],
    },
  }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_1",
    previousAssistantPart: false,
    group: { key: "grp_2", type: "context", refs: [{ messageID: "msg_1", partID: "part_1" }] },
  }),
  new TimelineRow.Thinking({ userMessageID: "msg_1", reasoningHeading: "Planning" }),
  new TimelineRow.Thinking({ userMessageID: "msg_1" }),
  new TimelineRow.Thinking({ userMessageID: "msg_2", reasoningHeading: "Planning" }),
  new TimelineRow.DiffSummary({ userMessageID: "msg_1", diffs: [diff("a.ts", "one")] }),
  new TimelineRow.DiffSummary({ userMessageID: "msg_1", diffs: [diff("a.ts", "one")] }),
  new TimelineRow.DiffSummary({ userMessageID: "msg_1", diffs: [diff("a.ts", "two")] }),
  new TimelineRow.Error({ userMessageID: "msg_1", text: "boom" }),
  new TimelineRow.Error({ userMessageID: "msg_1", text: "bang" }),
  new TimelineRow.Retry({ userMessageID: "msg_1" }),
  new TimelineRow.Retry({ userMessageID: "msg_2" }),
]

describe("TimelineRow.equals", () => {
  test("agrees with Equal.equals for every pair", () => {
    for (const a of rows) {
      for (const b of rows) {
        expect(TimelineRow.equals(a, b)).toBe(Equal.equals(a, b))
      }
    }
  })

  test("is reflexive and key-stable", () => {
    for (const row of rows) {
      expect(TimelineRow.equals(row, row)).toBe(true)
      expect(TimelineRow.key(row)).toBe(TimelineRow.key(row))
    }
  })
})
