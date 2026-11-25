import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { timelinePresets, type TimelineDetail } from "../timeline/detail"
import { toolEvent } from "./events"
import { placeContent, placeNotice } from "../timeline/place"
import { factsOf, toolStopped } from "../timeline/facts"
import { echoesUserShell, thoughtOpens } from "./rules"
import { timelineStatus } from "./status"

const preset = (id: string) => timelinePresets.find((item) => item.id === id)!.value

type Content = Parameters<typeof placeContent>[0]

const contentGroup = (detail: TimelineDetail, content: Content, commentary: ReadonlySet<Content>) => {
  const group = placeContent(content, detail, "next", commentary.has(content)).group

  return group === "part" ? undefined : group
}

const contentOpens = (detail: TimelineDetail, content: Content) => placeContent(content, detail, "next").opens

const contentShows = (detail: TimelineDetail, content: Content) =>
  placeContent(content, detail, "next").placement !== "hidden"

const noticePlacement = (detail: TimelineDetail, message: SessionMessageInfo) => placeNotice(message, detail, "next")

const toolFailed = (tool: SessionMessageAssistantTool) =>
  factsOf([tool]).some((fact) => fact.kind === "call" && fact.failed)

const custom = (overrides: Partial<TimelineDetail>): TimelineDetail => ({ ...preset("compact"), ...overrides })

const tool = (
  name: string,
  input: { [key: string]: string | boolean } = {},
  metadata: { [key: string]: string } = {},
): SessionMessageAssistantTool => ({
  id: name,
  type: "tool",
  name,
  state: { status: "completed", input, content: [{ type: "text", text: "" }], metadata },
  time: { created: 0 },
})

const errored = (
  name: string,
  error: { type: string; message: string },
  input: { [key: string]: string | boolean } = {},
): SessionMessageAssistantTool => ({
  ...tool(name, input),
  state: { status: "error", input, error, metadata: {} },
})

const backgroundShell = tool("shell", { command: "swift build", background: true })

const report = (source: "shell" | "subagent", state = "completed") =>
  ({
    id: `${source}-report`,
    type: "synthetic",
    text: "",
    description: "done",
    metadata: { source, state, shellID: "sh_1" },
    time: { created: 0 },
  }) satisfies SessionMessageInfo

describe("starting work that runs on follows its own setting", () => {
  test("a subagent launch leaves the parent working unless approval is pending", () => {
    const content = [{ ...tool("subagent"), state: { status: "running" as const, input: {}, metadata: {} } }]

    expect(timelineStatus({ content })).toBe("working")
    expect(timelineStatus({ content, blocked: "approval" })).toBe("waitingApproval")
  })

  test("a failed subagent launch says Started; a stored foreground result says Ran", () => {
    expect(
      toolEvent(errored("subagent", { type: "ToolExecutionError", message: "Failed to prompt subagent" })),
    ).toMatchObject({ verb: "started", failed: true })
    expect(toolEvent(tool("subagent", { background: true }))).toMatchObject({ verb: "started" })
    expect(toolEvent(tool("subagent", {}, { status: "completed" }))).toMatchObject({ verb: "ran", failed: false })
  })

  test("a background shell joins the activity group where shells are grouped, and stands alone where separate", () => {
    expect(contentGroup(preset("compact"), backgroundShell, new Set())).toBe("context")
    expect(contentGroup(preset("everything"), backgroundShell, new Set())).toBe("events")
  })

  test("prompting an existing child produces an update linked to that session", () => {
    expect(toolEvent(tool("subagent", { sessionID: "child", agent: "explore" }))).toMatchObject({
      verb: "updated",
      agent: "explore",
      sessionID: "child",
      title: undefined,
    })
  })

  test("a launch that failed keeps its own row, whatever the setting", () => {
    const failed = errored(
      "shell",
      { type: "tool.execution", message: "spawn failed" },
      { command: "x", background: true },
    )

    expect(contentGroup(preset("compact"), failed, new Set())).toBe("events")
  })

  test.each(["subagent", "task"])("%s has its own row in both visible placements", (name) => {
    expect(contentGroup(preset("compact"), tool(name), new Set())).toBe("subagent")
    expect(contentGroup(custom({ subagents: { placement: "grouped" } }), tool(name), new Set())).toBe("subagent")
  })

  test("a background shell's report follows the shell setting", () => {
    expect(noticePlacement(custom({ shell: { placement: "hidden", details: "collapsed" } }), report("shell"))).toBe(
      "hidden",
    )
    expect(noticePlacement(custom({ notices: { placement: "hidden" } }), report("shell"))).toBe("separate")
  })

  test("a failed report shows even where its setting hides it", () => {
    expect(
      noticePlacement(custom({ shell: { placement: "hidden", details: "collapsed" } }), report("shell", "error")),
    ).toBe("separate")
  })
})

describe("echoesUserShell", () => {
  test("the notice about a command the user ran echoes it; one about the agent's background shell does not", () => {
    expect(echoesUserShell(report("shell"), new Set(["sh_1"]))).toBe(true)
    expect(echoesUserShell(report("shell"), new Set(["sh_2"]))).toBe(false)
  })
})

describe("details", () => {
  test("shell details decide whether an agent's command opens to its whole output", () => {
    expect(contentOpens(preset("everything"), tool("shell"))).toBe(true)
    expect(contentOpens(preset("compact"), tool("shell"))).toBe(false)
    expect(contentOpens(preset("compact"), tool("execute"))).toBe(false)
  })

  test("thinking details stream the live thought in view, and every finished thought starts closed", () => {
    expect(thoughtOpens(preset("everything"), true)).toBe(true)
    expect(thoughtOpens(preset("compact"), true)).toBe(false)
    expect(thoughtOpens(preset("everything"), false)).toBe(false)
  })
})

describe("stopped calls", () => {
  const interrupted = { type: "aborted", message: "Tool execution interrupted" }
  const cancelled = { type: "unknown", message: "Command cancelled" }

  test("a call the user stopped or cancelled did not fail", () => {
    for (const error of [interrupted, cancelled]) {
      const call = errored("shell", error, { command: "git push" })

      expect(toolStopped(call)).toBe(true)
      expect(toolFailed(call)).toBe(false)
    }

    expect(toolFailed(errored("shell", { type: "tool.execution", message: "boom" }, { command: "x" }))).toBe(true)
  })

  test("a call stopped before the model finished writing it does not show", () => {
    expect(contentShows(preset("everything"), errored("shell", interrupted))).toBe(false)
    expect(contentShows(preset("everything"), errored("shell", interrupted, { command: "x" }))).toBe(true)
  })
})
