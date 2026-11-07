import { describe, expect, test } from "bun:test"
import {
  createShellRunState,
  INITIAL_SUBAGENT_RUN_STATE,
  shellRunProps,
  subagentRunProps,
  transitionShellRun,
  transitionSubagentRun,
  viewShellRun,
  viewSubagentRun,
  type ShellRunState,
  type SubagentRunState,
} from "./run-machine"

type ShellTool = Parameters<typeof shellRunProps>[0]

const running = (ids: string[]) => (id: string) => ids.includes(id)

function sync(state: ShellRunState, tool: ShellTool, live: string[] = []) {
  return transitionShellRun(state, { type: "sync", props: shellRunProps(tool, running(live)) })
}

describe("transitionShellRun", () => {
  test("a finished foreground agent shell shows its saved result instead of the read output", () => {
    const command = { command: "bun test" }
    // Core's shell tool reports the shell ID while it runs and `status: "completed"` once it finished.
    const progress = { shellID: "shl_1" }
    const result = { status: "completed", shellID: "shl_1", exit: 1, truncated: false }

    const live = createShellRunState(
      shellRunProps({ status: "running", input: command, metadata: progress, output: undefined }, running([])),
    )

    expect(viewShellRun(live).follow).toEqual({ id: "shl_1", running: true })

    const streamed = transitionShellRun(live, { type: "output.received", shellID: "shl_1", output: "out\n" })

    expect(viewShellRun(streamed).output).toBe("out\n")

    const done = sync(streamed, {
      status: "completed",
      input: command,
      metadata: result,
      output: "out\n\nExited with code 1",
    })

    expect(viewShellRun(done)).toMatchObject({
      pending: false,
      basicStatus: "completed",
      follow: undefined,
      output: "out\n\nExited with code 1",
    })
    expect(transitionShellRun(done, { type: "output.received", shellID: "shl_1", output: "late\n" })).toBe(done)
  })

  test("a killed user shell without saved output never reads the shell", () => {
    // `SessionShellMessage` renders a direct user shell through the shell tool with its message fields.
    const metadata = { shellID: "shl_user", status: "killed", exit: undefined, truncated: undefined }

    const state = createShellRunState(
      shellRunProps(
        { status: "completed", input: { command: "sleep 9" }, metadata, output: undefined },
        running(["shl_user"]),
      ),
    )

    expect(viewShellRun(state)).toMatchObject({ basicStatus: "completed", follow: undefined, output: "" })
  })

  test("a background shell follows the late running-shell inventory and keeps its read output", () => {
    const tool = {
      status: "completed",
      input: { command: "bun dev" },
      metadata: { status: "running", shellID: "shl_bg" },
      output: "Command moved to the background (shell ID: shl_bg).",
    }

    const before = createShellRunState(shellRunProps(tool, running([])))

    expect(viewShellRun(before)).toMatchObject({ basicStatus: "completed", follow: { id: "shl_bg", running: false } })

    const read = transitionShellRun(before, { type: "output.received", shellID: "shl_bg", output: "ready\n" })
    const live = sync(read, tool, ["shl_bg"])

    expect(viewShellRun(live)).toMatchObject({
      pending: true,
      basicStatus: "running",
      follow: { id: "shl_bg", running: true },
      output: "ready\n",
    })
    expect(sync(live, tool, ["shl_bg"])).toBe(live)

    const exited = sync(live, tool)

    expect(viewShellRun(exited)).toMatchObject({
      basicStatus: "completed",
      follow: { id: "shl_bg", running: false },
      output: "ready\n",
    })
  })

  test("output never crosses from one shell to another", () => {
    const tool = (shellID: string) => ({
      status: "running",
      input: { command: "ls" },
      metadata: { shellID },
      output: undefined,
    })

    const first = transitionShellRun(createShellRunState(shellRunProps(tool("shl_a"), running([]))), {
      type: "output.received",
      shellID: "shl_a",
      output: "a\n",
    })

    expect(transitionShellRun(first, { type: "output.received", shellID: "shl_b", output: "b\n" })).toBe(first)
    expect(viewShellRun(sync(first, tool("shl_b"))).output).toBe("")
  })

  test("shows the writing placeholder until the command arrives", () => {
    const writing = createShellRunState(
      shellRunProps({ status: "streaming", input: {}, metadata: {}, output: undefined }, running([])),
    )

    expect(viewShellRun(writing)).toMatchObject({ pending: true, basicStatus: "streaming", writingPlaceholder: true })
    expect(
      viewShellRun(sync(writing, { status: "streaming", input: { command: "ls" }, metadata: {}, output: undefined })),
    ).toMatchObject({ writingPlaceholder: false, command: "ls" })
  })
})

describe("transitionSubagentRun", () => {
  const child = { sessionID: "ses_child" }

  function step(state: SubagentRunState, tool: Parameters<typeof subagentRunProps>[0], childBusy = false) {
    return transitionSubagentRun(state, { type: "sync", props: subagentRunProps(tool, childBusy) })
  }

  test("a subagent handed to the background runs until its child session goes idle", () => {
    const delegating = step(INITIAL_SUBAGENT_RUN_STATE, { status: "streaming", metadata: {} })

    expect(delegating).toBe(INITIAL_SUBAGENT_RUN_STATE)
    expect(viewSubagentRun(delegating)).toMatchObject({ delegating: true, running: true })

    const foreground = step(delegating, { status: "running", metadata: {} }, true)

    expect(viewSubagentRun(foreground)).toEqual({
      delegating: false,
      running: true,
      basicStatus: "running",
      background: false,
    })

    // The call completes with `status: "running"` once the subagent moved to the background.
    const handoff = { status: "completed", metadata: { ...child, status: "running" } }
    const background = step(foreground, handoff, true)

    expect(viewSubagentRun(background)).toEqual({
      delegating: false,
      running: true,
      basicStatus: "running",
      background: true,
    })
    expect(step(background, handoff, true)).toBe(background)
    expect(viewSubagentRun(step(background, handoff))).toEqual({
      delegating: false,
      running: false,
      basicStatus: "completed",
      background: true,
    })
  })

  test("a failed call stops the spinner unless its child session is still busy", () => {
    const failed = step(INITIAL_SUBAGENT_RUN_STATE, { status: "error", metadata: {} })

    expect(viewSubagentRun(failed)).toMatchObject({ running: false, basicStatus: "error" })
    expect(viewSubagentRun(step(failed, { status: "error", metadata: {} }, true)).running).toBe(true)
  })
})
