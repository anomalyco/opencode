import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { Predicate } from "effect"
import { createRoot } from "solid-js"
import { subagentReport } from "../storybook/current-session-fixtures"
import { timelinePresets, type TimelineDetail } from "../timeline/detail"
import { createNextTimelineProjection, workedDuration } from "./projection"
import { replayScript, scenarios } from "./stories/session-replay"

const messagesOnly = timelinePresets.find((preset) => preset.id === "text-only")!.value

const detailed = timelinePresets.find((preset) => preset.id === "detailed")!.value

const step = (id: string, created: number, rest: Partial<SessionMessageAssistant> = {}): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  time: { created },
  ...rest,
})

describe("New timeline projection", () => {
  test("a stopped turn says how long it worked where the work stopped, above Interrupted and what followed", () => {
    const document = replayScript(scenarios["Feature work"], Number.MAX_SAFE_INTEGER, 0).document

    const tags = createRoot((dispose) => {
      const projection = createNextTimelineProjection({
        sessionMessages: () => document.messages,
        status: () => document.status,
        timelineDetail: () => messagesOnly,
      })

      const rows = projection.rows().map((row) => row._tag)
      dispose()

      return rows
    })

    const worked = tags.indexOf("Worked")

    expect(worked).toBeGreaterThan(-1)
    expect(tags.slice(worked, worked + 3)).toEqual(["Worked", "TurnDivider", "Notice"])
  })

  test("a grouped notice never joins a run of thoughts, which stay thought rows", () => {
    const thought = (id: string, created: number) =>
      step(id, created, {
        finish: "tool-calls",
        content: [{ type: "reasoning", text: "Checking the folder.", time: { created, completed: created + 1 } }],
        time: { created, completed: created + 1 },
      })

    const messages: SessionMessageInfo[] = [
      { id: "user", type: "user", text: "Go", time: { created: 0 } },
      thought("first", 1),
      {
        id: "notice",
        type: "system",
        text: "",
        description: "Instructions updated: core/codemode",
        metadata: { notice: "instructions", instructionSources: ["core/codemode"] },
        time: { created: 3 },
      },
      thought("second", 4),
    ]

    const groups = createRoot((dispose) => {
      const projection = createNextTimelineProjection({
        sessionMessages: () => messages,
        status: () => ({ type: "idle" }),
        timelineDetail: () => detailed,
      })

      const result = projection
        .rows()
        .flatMap((row) =>
          Predicate.isTagged(row, "AssistantPart") && row.group.type !== "part"
            ? [row.group.refs.map((ref) => ref.messageID).join("+")]
            : [],
        )

      dispose()

      return result
    })

    expect(groups).toEqual(["first", "notice", "second"])
  })

  test("a subagent's report shows above the status line before the agent takes it, and the user's input below", () => {
    const steer = { id: "steer", type: "user", text: "Also check the tests", time: { created: 2 } } as const

    const messages: SessionMessageInfo[] = [
      { id: "user", type: "user", text: "Go", time: { created: 0 } },
      step("working", 1, {
        content: [
          {
            id: "shell",
            type: "tool",
            name: "shell",
            state: { status: "running", input: { command: "sleep 60" }, metadata: {} },
            time: { created: 1 },
          },
        ],
      }),
      steer,
      subagentReport("report", 3, {
        childID: "child",
        agent: "explore",
        state: "completed",
        description: "Trace the bug",
        body: "Found it.",
      }),
    ]

    const rows = (messages: SessionMessageInfo[], pending: ReadonlySet<string>) =>
      createRoot((dispose) => {
        const projection = createNextTimelineProjection({
          sessionMessages: () => messages,
          status: () => ({ type: "busy" }),
          timelineDetail: () => detailed,
          pendingInputIDs: () => pending,
        })

        const result = projection.rows().map((row) => {
          if (!Predicate.isTagged(row, "AssistantPart")) return row._tag

          return row.group.type === "part"
            ? row.group.ref.messageID
            : row.group.refs.map((ref) => ref.messageID).join("+")
        })

        dispose()

        return result
      })

    const alone = messages.filter((message) => message !== steer)

    expect(rows(alone, new Set(["report"]))).toEqual(["UserMessage", "working", "report"])
    expect(rows(messages, new Set(["steer", "report"]))).toEqual([
      "UserMessage",
      "working",
      "report",
      "Activity",
      "TurnGap",
      "UserMessage",
    ])
  })

  test("a subagent finishes in the group that started it only when nothing comes between; otherwise it reports in its own row", () => {
    const launched: SessionMessageInfo[] = [
      { id: "user", type: "user", text: "Go", time: { created: 0 } },
      step("launch", 1, {
        finish: "tool-calls",
        content: [
          {
            id: "call",
            type: "tool",
            name: "subagent",
            state: {
              status: "completed",
              input: { description: "Review the diff", agent: "review" },
              content: [{ type: "text", text: "" }],
              metadata: { sessionID: "child", status: "running" },
            },
            time: { created: 1, completed: 2 },
          },
        ],
        time: { created: 1, completed: 2 },
      }),
    ]

    const report = subagentReport("report", 4, {
      childID: "child",
      agent: "review",
      state: "completed",
      description: "Review the diff",
      body: "Looks good.",
    })

    const said = step("said", 3, {
      finish: "stop",
      content: [{ type: "text", text: "Started a review." }],
      time: { created: 3, completed: 3 },
    })

    const groups = (messages: SessionMessageInfo[], detail: TimelineDetail) =>
      createRoot((dispose) => {
        const projection = createNextTimelineProjection({
          sessionMessages: () => messages,
          status: () => ({ type: "idle" }),
          timelineDetail: () => detail,
        })

        const result = projection
          .rows()
          .flatMap((row) =>
            Predicate.isTagged(row, "AssistantPart") && row.group.type !== "part"
              ? [`${row.group.type}:${row.group.refs.map((ref) => ref.messageID).join("+")}`]
              : [],
          )

        dispose()

        return result
      })

    const grouped = { ...detailed, subagents: { placement: "grouped" as const } }

    expect(groups([...launched, report], grouped)).toEqual(["context:launch+report"])
    expect(groups([...launched, said, report], grouped)).toEqual(["context:launch", "events:report"])
    expect(groups([...launched, report], detailed)).toEqual(["events:launch", "events:report"])
  })
})

describe("workedDuration", () => {
  test("a turn the user did not start runs from the agent's first step to the end of the stopped one", () => {
    const stopped = step("stopped", 3_000, {
      error: { type: "aborted", message: "The user interrupted the turn" },
      content: [
        {
          id: "shell",
          type: "tool",
          name: "shell",
          state: { status: "running", input: {}, metadata: {} },
          time: { created: 3_500, completed: 9_000 },
        },
      ],
    })

    expect(
      workedDuration(undefined, [step("first", 1_000, { time: { created: 1_000, completed: 2_000 } }), stopped]),
    ).toBe(8_000)
  })

  test("a turn the user started runs from their message", () => {
    const user = { id: "user", type: "user", text: "Go", time: { created: 500 } } satisfies SessionMessageUser

    const stopped = step("stopped", 1_000, {
      error: { type: "aborted", message: "The user interrupted the turn" },
      time: { created: 1_000, completed: 4_500 },
    })

    expect(workedDuration(user, [stopped])).toBe(4_000)
  })

  test("a turn nobody stopped has no worked time", () => {
    expect(workedDuration(undefined, [step("done", 1_000, { time: { created: 1_000, completed: 2_000 } })])).toBe(
      undefined,
    )
  })
})
