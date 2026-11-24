import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { Predicate } from "effect"
import { createRoot } from "solid-js"
import { commentaryRuns, subagentReport } from "../storybook/current-session-fixtures"
import { timelinePresets, type TimelineDetail } from "../timeline/detail"
import type { TimelineRow } from "../timeline/timeline-row"
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

  test("each subagent event stays in order in both visible placements, even without a title or visible launch", () => {
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

        const result = projection.rows().flatMap((row) => {
          if (Predicate.isTagged(row, "Notice")) return [`notice:${row.messageID}`]

          if (!Predicate.isTagged(row, "AssistantPart")) return []

          if (row.group.type === "part") return [`part:${row.group.ref.messageID}`]

          return [`${row.group.type}:${row.group.refs.map((ref) => ref.messageID).join("+")}`]
        })

        dispose()

        return result
      })

    const grouped = { ...detailed, subagents: { placement: "grouped" as const } }

    for (const detail of [grouped, detailed]) {
      expect(groups([...launched, report], detail)).toEqual(["subagent:launch", "subagent:report"])
      expect(groups([...launched, said, report], detail)).toEqual(["subagent:launch", "part:said", "subagent:report"])
      expect(groups([launched[0]!, report], detail)).toEqual(["subagent:report"])

      if (report.type !== "synthetic") throw new Error("Expected a subagent report")
      expect(groups([...launched, report, { ...report, id: "untitled", description: undefined }], detail)).toEqual([
        "subagent:launch",
        "subagent:report",
        "subagent:untitled",
      ])
    }

    expect(groups([...launched, report], messagesOnly)).toEqual([])
  })

  test.each(["grouped", "hidden"] as const)("%s commentary keeps the answer of each run", (placement) => {
    const runs = commentaryRuns()
    const detail = { ...timelinePresets[2].value, commentary: { placement } }

    const rows = (messages: SessionMessageInfo[], type: "idle" | "busy") =>
      createRoot((dispose) => {
        const projection = createNextTimelineProjection({
          sessionMessages: () => messages,
          status: () => ({ type }),
          timelineDetail: () => detail,
        })

        const result = projection.rows()
        dispose()

        return result
      })

    const groups = (rows: TimelineRow.TimelineRow[]) =>
      rows.flatMap((row) => {
        if (!Predicate.isTagged(row, "AssistantPart")) return []

        if (row.group.type === "part") return [`part:${row.group.ref.partID}`]

        return [`${row.group.type}:${row.group.refs.map((ref) => ref.partID).join("+")}`]
      })

    const complete = [
      "part:reply:text:0",
      ...[1, 2, 3].flatMap((index) => [
        placement === "grouped"
          ? `context:notice-${index}+work-${index}:text:0+tool-${index}`
          : `context:notice-${index}+tool-${index}`,
        `part:reply-${index}:text:0`,
      ]),
    ]

    expect(groups(rows(runs.complete, "idle"))).toEqual(complete)
    expect(groups(rows(runs.toolOnly, "busy"))).toEqual([...complete, "context:tool-only-notice+tool-only-call"])

    const live = [
      "part:prior:text:0",
      placement === "grouped" ? "context:wake+working:text:0+running" : "context:wake+running",
    ]

    expect(groups(rows(runs.busy, "busy"))).toEqual(live)
    expect(groups(rows(runs.failed, "busy"))).toEqual(live)

    expect({
      justClosed: groups(rows(runs.busy.slice(0, -2), "busy")),
      beforeStep: groups(rows(runs.busy.slice(0, -1), "busy")),
    }).toEqual({
      justClosed: ["part:prior:text:0"],
      beforeStep: ["part:prior:text:0", "context:wake"],
    })

    const withoutIdle = runs.complete.filter((message) => message.type !== "idle").slice(0, 5)

    expect(groups(rows(withoutIdle, "idle"))).toEqual([
      placement === "grouped" ? "context:reply:text:0+notice-1+work-1:text:0+tool-1" : "context:notice-1+tool-1",
      "part:reply-1:text:0",
    ])
  })

  test("a move shows only when it changes where the session is", () => {
    const moved = (id: string, created: number, from: string, to: string): SessionMessageInfo => ({
      id,
      type: "location-switched",
      location: { directory: to },
      previous: { location: { directory: from } },
      time: { created },
    })

    const messages: SessionMessageInfo[] = [
      { id: "user", type: "user", text: "Go", time: { created: 0 } },
      moved("into", 1, "/repo", "/repo-worktree"),
      moved("again", 2, "/repo-worktree", "/repo-worktree"),
      moved("back", 3, "/repo-worktree", "/repo"),
    ]

    const notices = createRoot((dispose) => {
      const projection = createNextTimelineProjection({
        sessionMessages: () => messages,
        status: () => ({ type: "idle" }),
        timelineDetail: () => detailed,
      })

      const result = projection.rows().flatMap((row) => (Predicate.isTagged(row, "Notice") ? [row.messageID] : []))
      dispose()

      return result
    })

    expect(notices).toEqual(["into", "back"])
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
