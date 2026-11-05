import { describe, expect, test } from "bun:test"
import {
  initialInstallCliState,
  transitionInstallCli,
  type InstallCliEvent,
  type InstallCliState,
  type InstallCliTransition,
} from "./install-cli-machine"

const replay = (events: readonly InstallCliEvent[], from: InstallCliState = initialInstallCliState()) =>
  events.reduce<InstallCliTransition>(
    (result, event) => {
      const next = transitionInstallCli(result.state, event)

      return { state: next.state, commands: [...result.commands, ...next.commands] }
    },
    { state: from, commands: [] },
  )

describe("CLI install machine", () => {
  test("a second click while the installer runs or its dialog is open starts no second installer", () => {
    const installing = transitionInstallCli(initialInstallCliState(), { type: "install.requested" })
    expect(installing.commands).toEqual([{ type: "run-install", attempt: 1 }])

    const again = transitionInstallCli(installing.state, { type: "install.requested" })
    expect(again.state).toBe(installing.state)
    expect(again.commands).toEqual([])

    const presenting = transitionInstallCli(installing.state, {
      type: "install.succeeded",
      attempt: 1,
      path: "/Users/me/.opencode/bin/opencode",
    })
    const outcome = { ok: true, path: "/Users/me/.opencode/bin/opencode" }
    expect(presenting.state).toEqual({ status: "presenting", attempt: 1, outcome })
    expect(presenting.commands).toEqual([{ type: "show-dialog", attempt: 1, outcome }])
    expect(transitionInstallCli(presenting.state, { type: "install.requested" }).state).toBe(presenting.state)

    expect(
      replay([{ type: "dialog.dismissed", attempt: 1 }, { type: "install.requested" }], presenting.state),
    ).toEqual({ state: { status: "installing", attempt: 2 }, commands: [{ type: "run-install", attempt: 2 }] })
  })

  test("a failure, timeout or resolve defect shows the error dialog and then accepts a retry", () => {
    const result = replay([
      { type: "install.requested" },
      { type: "install.failed", attempt: 1, error: "CLI installation timed out" },
    ])
    const outcome = { ok: false, error: "CLI installation timed out" }

    expect(result.state).toEqual({ status: "presenting", attempt: 1, outcome })
    expect(result.commands).toEqual([
      { type: "run-install", attempt: 1 },
      { type: "show-dialog", attempt: 1, outcome },
    ])
    expect(transitionInstallCli(result.state, { type: "dialog.dismissed", attempt: 1 }).state).toEqual({
      status: "idle",
      attempt: 1,
    })
  })

  test.each([
    { name: "a result while idle", events: [] as InstallCliEvent[], stale: { type: "install.succeeded", attempt: 1, path: "/x" } },
    {
      name: "a result from an earlier attempt",
      events: [
        { type: "install.requested" },
        { type: "install.failed", attempt: 1, error: "e" },
        { type: "dialog.dismissed", attempt: 1 },
        { type: "install.requested" },
      ],
      stale: { type: "install.failed", attempt: 1, error: "late" },
    },
    {
      name: "a dismissal while installing",
      events: [{ type: "install.requested" }],
      stale: { type: "dialog.dismissed", attempt: 1 },
    },
    {
      name: "a second result while presenting",
      events: [{ type: "install.requested" }, { type: "install.failed", attempt: 1, error: "e" }],
      stale: { type: "install.succeeded", attempt: 1, path: "/x" },
    },
  ] satisfies { name: string; events: InstallCliEvent[]; stale: InstallCliEvent }[])("$name is ignored", (row) => {
    const state = replay(row.events).state

    expect(transitionInstallCli(state, row.stale)).toEqual({ state, commands: [] })
  })

  test.each([
    { phase: "idle", events: [] },
    { phase: "installing", events: [{ type: "install.requested" }] },
    { phase: "presenting", events: [{ type: "install.requested" }, { type: "install.failed", attempt: 1, error: "e" }] },
  ] satisfies { phase: InstallCliState["status"]; events: InstallCliEvent[] }[])(
    "disposal while $phase ignores every later event",
    (row) => {
      const start = replay(row.events).state
      expect(start.status).toBe(row.phase)

      const disposed = transitionInstallCli(start, { type: "disposed" })
      expect(disposed).toEqual({ state: { status: "disposed" }, commands: [] })

      const late: InstallCliEvent[] = [
        { type: "install.requested" },
        { type: "install.succeeded", attempt: 1, path: "/x" },
        { type: "dialog.dismissed", attempt: 1 },
      ]
      late.forEach((event) => expect(transitionInstallCli(disposed.state, event).state).toBe(disposed.state))
    },
  )
})
