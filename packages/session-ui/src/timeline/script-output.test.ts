import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { labTool } from "../lab/current-session-scenarios"
import { scriptOutputLayout } from "./script-output"
import { TimelineRow } from "./timeline-row"

const messages = new Map<string, SessionMessageInfo>([
  [
    "msg_a",
    {
      id: "msg_a",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      time: { created: 1 },
      content: [labTool("script", "execute", "completed", { code: "…" }, { output: "ok" })],
    },
  ],
])

// The script's row, then its changes drawn as cards in the row after it, as Detailed places them.
const rows = [
  new TimelineRow.AssistantPart({
    userMessageID: "msg_u",
    group: { key: "part:msg_a:script", type: "part", ref: { messageID: "msg_a", partID: "script" } },
    previousAssistantPart: false,
  }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_u",
    group: {
      key: "part:msg_a:script:file:0:a.ts",
      type: "file",
      refs: [
        { messageID: "msg_a", partID: "script:file:0:a.ts" },
        { messageID: "msg_a", partID: "script:file:1:b.ts" },
      ],
    },
    previousAssistantPart: true,
    spacing: "tool",
  }),
]

// Changes grouped into a summary row with other edits, as Quiet places them, which the row may draw closed.
const grouped = [
  rows[0]!,
  new TimelineRow.AssistantPart({
    userMessageID: "msg_u",
    group: {
      key: "context:msg_a:script:file:0:a.ts",
      type: "context",
      refs: [
        { messageID: "msg_a", partID: "script:file:0:a.ts" },
        { messageID: "msg_a", partID: "script:file:1:b.ts" },
      ],
    },
    previousAssistantPart: true,
    spacing: "tool",
  }),
]

// The script and its changes as items of one group, as Compact places them.
const together = [
  new TimelineRow.AssistantPart({
    userMessageID: "msg_u",
    group: {
      key: "context:msg_a:script",
      type: "context",
      refs: [
        { messageID: "msg_a", partID: "script" },
        { messageID: "msg_a", partID: "script:file:0:a.ts" },
        { messageID: "msg_a", partID: "script:file:1:b.ts" },
      ],
    },
    previousAssistantPart: false,
  }),
]

describe("scriptOutputLayout", () => {
  test("moves a script's Output after its last change in the flat layout", () => {
    const layout = scriptOutputLayout(rows, messages, true)

    expect([...layout.afterChanges]).toEqual(["script"])
    expect([...layout.outputAfter.keys()]).toEqual(["msg_a:script:file:1:b.ts"])
  })

  test("keeps a script's Output under its steps when its changes are grouped into a summary row", () => {
    const layout = scriptOutputLayout(grouped, messages, true)

    expect(layout.afterChanges.size).toBe(0)
    expect(layout.outputAfter.size).toBe(0)
    expect(TimelineRow.scriptChanges(grouped[1]!)).toBe(false)
  })

  test("moves a script's Output after its last change when they share its group", () => {
    const layout = scriptOutputLayout(together, messages, true)

    expect([...layout.afterChanges]).toEqual(["script"])
    expect([...layout.outputAfter.keys()]).toEqual(["msg_a:script:file:1:b.ts"])
  })

  test("moves nothing without the flat layout", () => {
    const layout = scriptOutputLayout(rows, messages, false)

    expect(layout.afterChanges.size).toBe(0)
    expect(layout.outputAfter.size).toBe(0)
  })
})
