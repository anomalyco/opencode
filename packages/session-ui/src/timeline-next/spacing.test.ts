import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { TimelineRow } from "../timeline/timeline-row"
import { timelineGaps } from "./spacing"

const assistant = {
  id: "assistant",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [
    { type: "text", text: "The settings page renders its rows from general.tsx." },
    {
      id: "shell",
      type: "tool",
      name: "shell",
      state: {
        status: "completed",
        input: { command: "git status" },
        content: [{ type: "text", text: "" }],
        metadata: {},
      },
      time: { created: 0 },
    },
    { type: "text", text: "Added a Dark mode toggle." },
  ],
  time: { created: 0 },
} satisfies SessionMessageAssistant

const goal = {
  id: "goal",
  type: "synthetic",
  text: "goal",
  description: "Goal: Ship dark mode",
  metadata: { source: "goal" },
  time: { created: 1 },
} satisfies SessionMessageInfo

const switched = {
  id: "switched",
  type: "synthetic",
  text: "switched",
  description: "Switched model",
  time: { created: 2 },
} satisfies SessionMessageInfo

const messages = new Map<string, SessionMessageInfo>([
  [assistant.id, assistant],
  [goal.id, goal],
  [switched.id, switched],
])

const part = (key: string, partID: string) =>
  new TimelineRow.AssistantPart({
    userMessageID: "user",
    group: { key, type: "part", ref: { messageID: assistant.id, partID } },
    previousAssistantPart: true,
  })

const context = (key: string) =>
  new TimelineRow.AssistantPart({
    userMessageID: "user",
    group: { key, type: "context", refs: [{ messageID: assistant.id, partID: "read" }] },
    previousAssistantPart: true,
  })

const gaps = (rows: TimelineRow.TimelineRow[]) => {
  const result = timelineGaps(rows, messages)

  return rows.map((row) => result.get(TimelineRow.key(row)) ?? "-")
}

describe("timelineGaps", () => {
  test("lines of activity in a row sit the small gap apart", () => {
    expect(gaps([context("context:explored"), context("context:edited")])).toEqual(["-", "s"])
  })

  test("a reply reads as one stretch, its words a little apart from its activity", () => {
    expect(
      gaps([
        new TimelineRow.UserMessage({ userMessageID: "user" }),
        context("context:explored"),
        part("part:text-0", "assistant:text:0"),
        context("context:edited"),
        part("part:text-1", "assistant:text:1"),
      ]),
    ).toEqual(["-", "l", "m", "m", "m"])
  })

  test("the agent's words sit a little apart from its activity, a command included", () => {
    expect(
      gaps([
        part("part:text-0", "assistant:text:0"),
        part("part:shell", "shell"),
        part("part:text-1", "assistant:text:1"),
      ]),
    ).toEqual(["-", "m", "m"])
  })

  test("a file sits as any row of activity does", () => {
    expect(
      gaps([
        part("part:text-0", "assistant:text:0"),
        new TimelineRow.AssistantPart({
          userMessageID: "user",
          group: { key: "file:edited", type: "file", refs: [{ messageID: assistant.id, partID: "patch" }] },
          previousAssistantPart: true,
        }),
        context("context:next"),
      ]),
    ).toEqual(["-", "m", "s"])
  })

  test("each thing the user did stands apart, even from another thing they did", () => {
    expect(
      gaps([
        part("part:text-1", "assistant:text:1"),
        new TimelineRow.Shell({ userMessageID: "shell-turn", messageID: "user-shell" }),
        new TimelineRow.Notice({ userMessageID: "shell-turn", messageID: goal.id }),
        context("context:next"),
      ]),
    ).toEqual(["-", "l", "l", "l"])
  })

  test("session events sit together, apart from the work around them", () => {
    expect(
      gaps([
        context("context:edited"),
        new TimelineRow.TurnDivider({ userMessageID: "user" }),
        new TimelineRow.Notice({ userMessageID: "user", messageID: switched.id }),
        new TimelineRow.UserMessage({ userMessageID: "next" }),
      ]),
    ).toEqual(["-", "l", "s", "l"])
  })
})
