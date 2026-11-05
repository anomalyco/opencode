import { describe, expect, test } from "bun:test"
import type { PersistentPtyInfo } from "@opencode/client"
import {
  initialState,
  serverAvailable,
  sessionConnection,
  sessionView,
  tabHidden,
  transition,
  viewTabs,
  type Event,
  type State,
  type Transition,
} from "./machine"

const info = (id: string, title = id): PersistentPtyInfo => ({
  id,
  title,
  userTitle: null,
  command: "/bin/zsh",
  args: [],
  cwd: "/repo",
  status: "running",
  pid: 1,
  sessionID: "ses_1",
  foregroundProcess: null,
  size: { cols: 80, rows: 24 },
  output: { head: 0, tail: 0 },
})

// Folds the events in order and returns the last transition.
const replay = (events: readonly Event[], state: State = initialState) =>
  events.reduce<Transition>((last, event) => transition(last.state, event), { state, commands: [] })

// A supported server whose ses_1 listed pty_1 with attempt 2.
const listed = () =>
  replay([
    { type: "server.connected" },
    { type: "session.loaded", sessionID: "ses_1" },
    { type: "capability.checked", attempt: 1, supported: true },
    { type: "list.loaded", sessionID: "ses_1", attempt: 2, items: [info("pty_1")] },
  ]).state

describe("terminal machine", () => {
  test("a list that fails with an error other than 503 shows its error and its tabs, and retries on request", () => {
    const failed = replay([
      { type: "session.loaded", sessionID: "ses_1" },
      { type: "capability.checked", attempt: 1, supported: true },
      { type: "list.failed", sessionID: "ses_1", attempt: 2, error: "boom" },
    ])

    const view = sessionView(failed.state, "ses_1")

    expect(view).toEqual({ type: "failed", error: "boom" })
    expect(tabHidden(view)).toBe(false)
    expect(viewTabs(view, ["pty_restored"])).toEqual(["pty_restored"])
    expect(serverAvailable(failed.state)).toBe(true)

    const retried = transition(failed.state, { type: "session.retry", sessionID: "ses_1" })

    expect(sessionView(retried.state, "ses_1")).toEqual({ type: "loading" })
    expect(retried.commands).toEqual([{ type: "load-list", sessionID: "ses_1", attempt: 3 }])

    const loaded = transition(retried.state, {
      type: "list.loaded",
      sessionID: "ses_1",
      attempt: 3,
      items: [info("pty_1")],
    })

    expect(sessionView(loaded.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1")] })
    expect(loaded.commands).toEqual([{ type: "sync-tabs", sessionID: "ses_1", items: [info("pty_1")] }])
  })

  test("loading a session again changes nothing, so reactive reads never retry a failed list", () => {
    const loading = replay([
      { type: "session.loaded", sessionID: "ses_1" },
      { type: "capability.checked", attempt: 1, supported: true },
    ]).state

    const failed = transition(loading, { type: "list.failed", sessionID: "ses_1", attempt: 2, error: "boom" }).state

    const states = [loading, failed, listed()]

    states.forEach((state) => {
      const again = transition(state, { type: "session.loaded", sessionID: "ses_1" })

      expect(again.state).toBe(state)
      expect(again.commands).toEqual([])
    })

    // Retrying anything but a failed list repeats nothing.
    expect(transition(loading, { type: "session.retry", sessionID: "ses_1" }).state).toBe(loading)
  })

  test("a support answer from before a reconnect is ignored", () => {
    const rechecked = replay([
      { type: "server.connected" },
      { type: "session.loaded", sessionID: "ses_1" },
      { type: "server.connected" },
    ])

    expect(rechecked.commands).toEqual([{ type: "check-capability", attempt: 2 }])

    const stale = replay(
      [
        { type: "capability.checked", attempt: 1, supported: false },
        { type: "capability.failed", attempt: 1, error: "offline" },
      ],
      rechecked.state,
    )

    expect(stale.state).toBe(rechecked.state)

    const supported = transition(rechecked.state, { type: "capability.checked", attempt: 2, supported: true })

    expect(supported.state.status).toBe("supported")
    expect(supported.commands).toEqual([{ type: "load-list", sessionID: "ses_1", attempt: 3 }])
  })

  test("only the latest list request settles a session", () => {
    const refreshing = transition(listed(), { type: "session.refresh", sessionID: "ses_1" })

    expect(refreshing.commands).toEqual([{ type: "load-list", sessionID: "ses_1", attempt: 3 }])

    const newer = transition(refreshing.state, { type: "session.refresh", sessionID: "ses_1" })

    const stale = replay(
      [
        { type: "list.loaded", sessionID: "ses_1", attempt: 3, items: [] },
        { type: "list.failed", sessionID: "ses_1", attempt: 3, error: "old" },
        { type: "list.unavailable", sessionID: "ses_1", attempt: 3 },
      ],
      newer.state,
    )

    expect(stale.state).toBe(newer.state)
    expect(sessionView(newer.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1")] })

    const settled = transition(newer.state, {
      type: "list.loaded",
      sessionID: "ses_1",
      attempt: 4,
      items: [info("pty_1"), info("pty_2")],
    })

    expect(sessionView(settled.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1"), info("pty_2")] })
  })

  test("a 503 for the latest request marks the server unavailable until a reconnect finds support", () => {
    const loading = transition(listed(), { type: "session.refresh", sessionID: "ses_1" }).state
    const unavailable = transition(loading, { type: "list.unavailable", sessionID: "ses_1", attempt: 3 }).state
    const view = sessionView(unavailable, "ses_1")

    expect(serverAvailable(unavailable)).toBe(false)
    expect(view).toEqual({ type: "unsupported" })
    expect(tabHidden(view)).toBe(true)
    expect(viewTabs(view, ["pty_1"])).toEqual(["pty_1"])

    const reconnected = transition(unavailable, { type: "server.connected" })

    expect(reconnected.commands).toEqual([{ type: "check-capability", attempt: 4 }])

    const supported = transition(reconnected.state, { type: "capability.checked", attempt: 4, supported: true })

    expect(supported.commands).toEqual([{ type: "load-list", sessionID: "ses_1", attempt: 5 }])
  })

  test("a failed refresh keeps the terminals already shown", () => {
    const refreshing = transition(listed(), { type: "session.refresh", sessionID: "ses_1" }).state

    expect(sessionView(refreshing, "ses_1")).toEqual({ type: "ready", items: [info("pty_1")] })

    const failed = transition(refreshing, { type: "list.failed", sessionID: "ses_1", attempt: 3, error: "boom" })

    expect(sessionView(failed.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1")] })
  })

  test("a reconnect keeps listed terminals shown, drops answers from before it, and lists every session again", () => {
    const supported = transition(listed(), { type: "session.loaded", sessionID: "ses_2" })

    expect(supported.commands).toEqual([{ type: "load-list", sessionID: "ses_2", attempt: 3 }])

    const rechecking = transition(supported.state, { type: "server.connected" })

    expect(rechecking.commands).toEqual([{ type: "check-capability", attempt: 4 }])
    expect(sessionView(rechecking.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1")] })
    expect(sessionView(rechecking.state, "ses_2")).toEqual({ type: "loading" })

    const late = transition(rechecking.state, { type: "list.unavailable", sessionID: "ses_2", attempt: 3 })

    expect(late.state).toBe(rechecking.state)

    const relisted = transition(rechecking.state, { type: "capability.checked", attempt: 4, supported: true })

    expect(relisted.commands).toEqual([
      { type: "load-list", sessionID: "ses_1", attempt: 5 },
      { type: "load-list", sessionID: "ses_2", attempt: 6 },
    ])
    expect(sessionView(relisted.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1")] })
  })

  test("a terminal update replaces a listed terminal and lists again for an unknown one", () => {
    const state = listed()

    const renamed = transition(state, {
      type: "terminal.updated",
      sessionID: "ses_1",
      terminal: info("pty_1", "build"),
    })

    expect(renamed.commands).toEqual([])
    expect(sessionView(renamed.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1", "build")] })

    const unknown = transition(state, { type: "terminal.updated", sessionID: "ses_1", terminal: info("pty_9") })

    expect(unknown.commands).toEqual([{ type: "load-list", sessionID: "ses_1", attempt: 3 }])

    // A local change to a terminal the list doesn't have, or an update for a session never loaded, changes nothing.
    expect(transition(state, { type: "terminal.replaced", sessionID: "ses_1", terminal: info("pty_9") }).state).toBe(
      state,
    )
    expect(transition(state, { type: "terminal.updated", sessionID: "ses_9", terminal: info("pty_9") }).state).toBe(
      state,
    )
  })

  test("answers for a removed session are ignored", () => {
    const loading = replay([
      { type: "session.loaded", sessionID: "ses_1" },
      { type: "capability.checked", attempt: 1, supported: true },
      { type: "sessions.removed", sessionIDs: ["ses_1"] },
    ]).state

    const late = replay(
      [
        { type: "list.loaded", sessionID: "ses_1", attempt: 2, items: [info("pty_1")] },
        { type: "list.unavailable", sessionID: "ses_1", attempt: 2 },
        { type: "list.failed", sessionID: "ses_1", attempt: 2, error: "boom" },
      ],
      loading,
    )

    expect(late.state).toBe(loading)

    // Loading it again takes a new attempt rather than reusing the abandoned one.
    expect(transition(loading, { type: "session.loaded", sessionID: "ses_1" }).commands).toEqual([
      { type: "load-list", sessionID: "ses_1", attempt: 3 },
    ])
  })

  test("a session's connection moves to a reconnect only once that connection lists it", () => {
    expect(sessionConnection(initialState, "ses_1")).toBe(0)

    const first = listed()

    expect(sessionConnection(first, "ses_1")).toBe(1)

    // A refresh, and a refresh that fails, keep the connection the known list came from.
    const refreshed = replay(
      [
        { type: "session.refresh", sessionID: "ses_1" },
        { type: "list.loaded", sessionID: "ses_1", attempt: 3, items: [info("pty_1")] },
        { type: "session.refresh", sessionID: "ses_1" },
        { type: "list.failed", sessionID: "ses_1", attempt: 4, error: "boom" },
      ],
      first,
    ).state

    expect(sessionConnection(refreshed, "ses_1")).toBe(1)

    // A restarted server: the list stays at the old connection while support is checked and the list loads again.
    const checking = transition(refreshed, { type: "server.connected" }).state

    expect(sessionConnection(checking, "ses_1")).toBe(1)

    const relisting = transition(checking, { type: "capability.checked", attempt: 5, supported: true }).state

    expect(sessionConnection(relisting, "ses_1")).toBe(1)

    const failed = transition(relisting, { type: "list.failed", sessionID: "ses_1", attempt: 6, error: "boom" }).state

    expect(sessionConnection(failed, "ses_1")).toBe(1)

    const relisted = replay(
      [
        { type: "server.connected" },
        { type: "capability.checked", attempt: 7, supported: true },
        { type: "list.loaded", sessionID: "ses_1", attempt: 8, items: [info("pty_1")] },
      ],
      failed,
    ).state

    expect(sessionConnection(relisted, "ses_1")).toBe(3)
    expect(sessionConnection(relisted, "ses_2")).toBe(0)
  })

  test("a failed support check shows its error with a retry that checks again", () => {
    const failed = replay([
      { type: "server.connected" },
      { type: "session.loaded", sessionID: "ses_1" },
      { type: "capability.failed", attempt: 1, error: "offline" },
    ]).state

    const view = sessionView(failed, "ses_1")

    expect(view).toEqual({ type: "failed", error: "offline" })
    expect(tabHidden(view)).toBe(false)
    expect(serverAvailable(failed)).toBe(false)

    const retried = transition(failed, { type: "session.retry", sessionID: "ses_1" })

    expect(retried.commands).toEqual([{ type: "check-capability", attempt: 2 }])
    expect(sessionView(retried.state, "ses_1")).toEqual({ type: "loading" })
  })
})
