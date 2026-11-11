import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { timelinePresets, type TimelineDetail } from "../timeline/detail"
import {
  contentGroup,
  contentOpens,
  contentShows,
  echoesUserShell,
  noticePlacement,
  thoughtOpens,
  toolFailed,
  toolStopped,
  userShellOpens,
} from "./rules"

const preset = (id: string) => timelinePresets.find((item) => item.id === id)!.value

const custom = (overrides: Partial<TimelineDetail>): TimelineDetail => ({ ...preset("compact"), ...overrides })

const tool = (name: string, input: { [key: string]: string | boolean } = {}): SessionMessageAssistantTool => ({
  id: name,
  type: "tool",
  name,
  state: { status: "completed", input, content: [{ type: "text", text: "" }], metadata: {} },
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
  test("a background shell joins the activity group where shells are grouped, and stands alone where separate", () => {
    expect(contentGroup(preset("compact"), backgroundShell, new Set())).toBe("context")
    expect(contentGroup(preset("everything"), backgroundShell, new Set())).toBe("events")
  })

  test("a launch that failed keeps its own row, whatever the setting", () => {
    const failed = errored(
      "shell",
      { type: "tool.execution", message: "spawn failed" },
      { command: "x", background: true },
    )

    expect(contentGroup(preset("compact"), failed, new Set())).toBe("events")
  })

  test("a subagent follows the subagent setting, not the tools or shell one", () => {
    expect(contentGroup(preset("compact"), tool("subagent"), new Set())).toBe("events")
    expect(contentGroup(custom({ subagents: { placement: "grouped" } }), tool("subagent"), new Set())).toBe("context")
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
  test("shell details decide whether a command's whole output shows, for the agent's commands and the user's", () => {
    expect(contentOpens(preset("everything"), tool("shell"))).toBe(true)
    expect(contentOpens(preset("compact"), tool("shell"))).toBe(false)
    expect(contentOpens(preset("compact"), tool("execute"))).toBe(false)
    expect(userShellOpens(preset("everything"))).toBe(true)
    expect(userShellOpens(preset("compact"))).toBe(false)
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
