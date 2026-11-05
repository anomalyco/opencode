import { describe, expect, test } from "bun:test"
import type { PersistentPtyInfo } from "@opencode/client"
import {
  initialState,
  serverAvailable,
  sessionConnection,
  sessionCreating,
  sessionView,
  tabHidden,
  transition,
  viewItems,
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

    expect(rechecked.commands).toEqual([
      { type: "abort", attempts: [1] },
      { type: "check-capability", attempt: 2 },
    ])

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

    // The reconnect stops the list it no longer waits for.
    expect(rechecking.commands).toEqual([
      { type: "abort", attempts: [3] },
      { type: "check-capability", attempt: 4 },
    ])
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

    // An update for a session never loaded changes nothing.
    expect(transition(state, { type: "terminal.updated", sessionID: "ses_9", terminal: info("pty_9") }).state).toBe(
      state,
    )
  })

  // The create answer and the server's `persistent-pty.added` race: the refresh the event started can answer without
  // the new terminal. The new tab is listed at once, so selecting it settles focus.
  test("a terminal this client created is listed before a newer refresh answers", () => {
    const requested = transition(listed(), { type: "create.requested", sessionID: "ses_1" })

    expect(requested.commands).toEqual([
      { type: "create-terminal", sessionID: "ses_1", attempt: 3, known: [info("pty_1")] },
    ])

    const added = transition(requested.state, { type: "session.refresh", sessionID: "ses_1" }).state

    const created = transition(added, {
      type: "create.succeeded",
      sessionID: "ses_1",
      attempt: 3,
      terminal: info("pty_2"),
    })

    expect(created.commands).toEqual([
      { type: "settle-create", sessionID: "ses_1", outcome: { ok: true, terminal: info("pty_2") } },
      { type: "abort", attempts: [4] },
      { type: "load-list", sessionID: "ses_1", attempt: 5 },
    ])
    expect(sessionView(created.state, "ses_1")).toEqual({ type: "ready", items: [info("pty_1"), info("pty_2")] })
    expect(sessionCreating(created.state, "ses_1")).toBe(false)

    // The refresh it replaced answers without the new terminal; it is stale.
    const stale = transition(created.state, {
      type: "list.loaded",
      sessionID: "ses_1",
      attempt: 4,
      items: [info("pty_1")],
    })

    expect(stale.state).toBe(created.state)
  })

  // Double-clicking "+" or pressing the shortcut twice used to send two creates, both titled "Terminal 1".
  test("a second new-terminal request joins the create in flight", () => {
    const first = transition(listed(), { type: "create.requested", sessionID: "ses_1" })
    const second = transition(first.state, { type: "create.requested", sessionID: "ses_1" })

    expect(first.commands).toEqual([
      { type: "create-terminal", sessionID: "ses_1", attempt: 3, known: [info("pty_1")] },
    ])
    expect(second.state).toBe(first.state)
    expect(second.commands).toEqual([])
    expect(sessionCreating(first.state, "ses_1")).toBe(true)

    // A failed or timed-out create answers every request it joined once, and the next request creates again.
    const failed = transition(first.state, {
      type: "create.failed",
      sessionID: "ses_1",
      attempt: 3,
      kind: "failed",
      error: "timed out",
    })

    expect(failed.commands).toEqual([
      { type: "settle-create", sessionID: "ses_1", outcome: { ok: false, kind: "failed", error: "timed out" } },
    ])
    expect(sessionCreating(failed.state, "ses_1")).toBe(false)
    expect(transition(failed.state, { type: "create.requested", sessionID: "ses_1" }).commands).toEqual([
      { type: "create-terminal", sessionID: "ses_1", attempt: 4, known: [info("pty_1")] },
    ])
  })

  test("a create while support is checked lists first, and a server without terminals answers it at once", () => {
    const checking = replay([{ type: "server.connected" }, { type: "session.loaded", sessionID: "ses_1" }]).state
    const requested = transition(checking, { type: "create.requested", sessionID: "ses_1" })

    expect(requested.commands).toEqual([{ type: "create-terminal", sessionID: "ses_1", attempt: 2, known: undefined }])

    // Losing support ends the create in flight and tells the user why.
    const unsupported = transition(requested.state, { type: "capability.checked", attempt: 1, supported: false })

    expect(unsupported.commands).toEqual([
      { type: "abort", attempts: [2] },
      { type: "settle-create", sessionID: "ses_1", outcome: { ok: false, kind: "unsupported" } },
    ])
    expect(transition(unsupported.state, { type: "create.requested", sessionID: "ses_1" }).commands).toEqual([
      { type: "settle-create", sessionID: "ses_1", outcome: { ok: false, kind: "unsupported" } },
    ])
  })

  // An older rename that answered after a newer one used to put the older title back; two failed renames rolled back
  // to the first one's unconfirmed title.
  test("only the newest rename settles a terminal's title", () => {
    const alpha = transition(listed(), { type: "rename.requested", sessionID: "ses_1", ptyID: "pty_1", title: "alpha" })
    const beta = transition(alpha.state, {
      type: "rename.requested",
      sessionID: "ses_1",
      ptyID: "pty_1",
      title: "beta",
    })

    expect(beta.commands).toEqual([
      { type: "abort", attempts: [3] },
      { type: "rename-terminal", sessionID: "ses_1", ptyID: "pty_1", title: "beta", attempt: 4 },
    ])
    expect(viewItems(sessionView(beta.state, "ses_1"))[0]).toMatchObject({ title: "beta", userTitle: "beta" })

    const renamed = (title: string) => ({ ...info("pty_1", title), userTitle: title })

    const settled = replay(
      [
        { type: "rename.succeeded", sessionID: "ses_1", ptyID: "pty_1", attempt: 4, terminal: renamed("beta") },
        { type: "rename.succeeded", sessionID: "ses_1", ptyID: "pty_1", attempt: 3, terminal: renamed("alpha") },
      ],
      beta.state,
    )

    expect(viewItems(sessionView(settled.state, "ses_1"))).toEqual([renamed("beta")])

    const failed = replay(
      [
        { type: "rename.failed", sessionID: "ses_1", ptyID: "pty_1", attempt: 3, kind: "failed", error: "old" },
        { type: "rename.failed", sessionID: "ses_1", ptyID: "pty_1", attempt: 4, kind: "failed", error: "boom" },
      ],
      beta.state,
    )

    // The confirmed title shows again, not the first rename's.
    expect(viewItems(sessionView(failed.state, "ses_1"))).toEqual([info("pty_1")])
    expect(failed.commands).toEqual([{ type: "toast-rename-failed", kind: "failed", error: "boom" }])

    // Asking for the title a pending rename already sends, or the current title, sends nothing.
    expect(
      transition(beta.state, { type: "rename.requested", sessionID: "ses_1", ptyID: "pty_1", title: "beta" }).state,
    ).toBe(beta.state)
    expect(
      transition(listed(), { type: "rename.requested", sessionID: "ses_1", ptyID: "pty_1", title: "pty_1" }).commands,
    ).toEqual([])
  })

  // A failed close used to end in a console line: the tab stayed gone with its terminal still running.
  test("a close runs once, ends a pending rename, and brings the tab back when it fails", () => {
    const renaming = transition(listed(), {
      type: "rename.requested",
      sessionID: "ses_1",
      ptyID: "pty_1",
      title: "alpha",
    }).state
    const closing = transition(renaming, { type: "close.requested", sessionID: "ses_1", ptyID: "pty_1" })

    expect(closing.commands).toEqual([
      { type: "abort", attempts: [3] },
      { type: "close-terminal", sessionID: "ses_1", ptyID: "pty_1", attempt: 4 },
    ])
    expect(transition(closing.state, { type: "close.requested", sessionID: "ses_1", ptyID: "pty_1" }).state).toBe(
      closing.state,
    )
    expect(
      transition(closing.state, { type: "rename.requested", sessionID: "ses_1", ptyID: "pty_1", title: "beta" }).state,
    ).toBe(closing.state)

    const failed = transition(closing.state, {
      type: "close.failed",
      sessionID: "ses_1",
      ptyID: "pty_1",
      attempt: 4,
      error: "boom",
    })

    expect(failed.commands).toEqual([
      { type: "sync-tabs", sessionID: "ses_1", items: [info("pty_1")] },
      { type: "toast-close-failed", error: "boom" },
    ])

    const closed = transition(closing.state, {
      type: "close.succeeded",
      sessionID: "ses_1",
      ptyID: "pty_1",
      attempt: 4,
    })

    expect(viewItems(sessionView(closed.state, "ses_1"))).toEqual([])
    expect(closed.commands).toEqual([{ type: "load-list", sessionID: "ses_1", attempt: 5 }])
  })

  test("removing a session or stopping the model ends its changes in flight and keeps confirmed lists", () => {
    const busy = replay(
      [
        { type: "create.requested", sessionID: "ses_1" },
        { type: "rename.requested", sessionID: "ses_1", ptyID: "pty_1", title: "alpha" },
        { type: "session.refresh", sessionID: "ses_1" },
      ],
      listed(),
    ).state

    const removed = transition(busy, { type: "sessions.removed", sessionIDs: ["ses_1"] })

    expect(removed.commands).toEqual([
      { type: "abort", attempts: [5, 3, 4] },
      { type: "settle-create", sessionID: "ses_1", outcome: { ok: false, kind: "cancelled" } },
    ])
    expect(sessionCreating(removed.state, "ses_1")).toBe(false)

    const stopped = transition(busy, { type: "instance.stopped" })

    expect(stopped.commands).toEqual([
      { type: "settle-create", sessionID: "ses_1", outcome: { ok: false, kind: "cancelled" } },
    ])
    expect(sessionCreating(stopped.state, "ses_1")).toBe(false)
    // The pending rename's title leaves with it; the confirmed list stays for the next instance.
    expect(viewItems(sessionView(stopped.state, "ses_1"))).toEqual([info("pty_1")])
    expect(transition(stopped.state, { type: "instance.stopped" }).state).toBe(stopped.state)
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
