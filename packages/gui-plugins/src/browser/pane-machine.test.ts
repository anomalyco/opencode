import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { SessionNotFoundError } from "@opencode/protocol/errors"
import {
  attachmentFailure,
  createPaneState,
  decodeControl,
  decodeControlHeader,
  isCurrentPage,
  resolveControlFrame,
  selectBinding,
  transitionBinding,
  transitionPane,
  type BindingEvent,
  type PaneEffect,
  type PaneMachineEvent,
  type PaneState,
} from "./pane-machine"

const connectionID = "connection-1"

const tabA = Browser.TabID.make("tab_00000000-0000-0000-0000-00000000000a")

const tabB = Browser.TabID.make("tab_00000000-0000-0000-0000-00000000000b")

const missing = Browser.TabID.make("tab_00000000-0000-0000-0000-0000000000ff")

const dashboard = "http://localhost:4173/dashboard"

function tab(id: Browser.TabID, url: string, title = "", generation = 0): Browser.Tab {
  return { id, url, title, loading: false, canGoBack: false, canGoForward: false, generation }
}

function registered(restore?: Browser.State, binding = "b1"): PaneMachineEvent {
  return {
    type: "registered",
    binding,
    window: 1,
    storageKey: `server\n${binding}`,
    restore,
    saved: { tabs: [], focusedTabID: null },
  }
}

function on(event: BindingEvent, binding = "b1"): PaneMachineEvent {
  return { type: "binding", binding, event }
}

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: PaneState, ...events: PaneMachineEvent[]) {
  return events.reduce<{ state: PaneState; effects: readonly PaneEffect[] }>(
    (result, event) => {
      const next = transitionPane(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// The server reads the raw control event exactly as the driver does.
function frame(data: {
  readonly type: string
  readonly connectionID: string
  readonly version?: number
  readonly requestID?: string
}) {
  return resolveControlFrame(connectionID, decodeControlHeader(data), decodeControl(data))
}

function attached(restore?: Browser.State) {
  return play(createPaneState(), registered(restore), on({ type: "server.attached", fileRoots: [] })).state
}

function entry(state: PaneState, binding = "b1") {
  const value = selectBinding(state, binding)

  if (!value) throw new Error(`binding ${binding} is not active`)

  return value
}

function closeEvents(effects: readonly PaneEffect[]) {
  return effects.flatMap((effect) =>
    effect.type === "emit" && effect.event.type === "state"
      ? [{ state: effect.event.state, error: effect.event.error }]
      : [],
  )
}

// tab_a restored at the dashboard, loaded as attempt 1, and published live.
function liveDashboard() {
  return play(
    attached({ tabs: [tab(tabA, dashboard, "Dashboard")], focusedTabID: tabA }),
    on({ type: "tab.opened", tabID: tabA, attempt: 1, tab: tab(tabA, dashboard, "Dashboard", 1) }),
    on({ type: "tab.published", tabID: tabA, attempt: 1, tab: tab(tabA, dashboard, "Dashboard", 1) }),
  ).state
}

describe("control events", () => {
  test("an unknown control type from a newer server leaves the binding open", () => {
    const unknown = frame({ type: "future.ping", connectionID })
    expect(unknown).toEqual({ kind: "unrecognized", controlType: "future.ping" })

    const connecting = entry(play(createPaneState(), registered()).state)

    const open = entry(attached())

    ;[connecting, open].forEach((state) => {
      const next = transitionBinding(state, { type: "control.unrecognized", controlType: "future.ping" })
      expect(next.state).toBe(state)
      expect(next.effects.map((effect) => effect.type)).toEqual(["warn"])
    })
  })

  test("an attached handshake this desktop cannot decode marks the server unsupported", () => {
    expect(frame({ type: "attached", connectionID, version: 5 })).toEqual({ kind: "incompatible" })
    expect(frame({ type: "attached", connectionID })).toEqual({ kind: "incompatible" })

    const next = play(attached(), on({ type: "handshake.unsupported" }))
    expect(selectBinding(next.state, "b1")).toBeUndefined()
    expect(closeEvents(next.effects)).toEqual([{ state: null, error: "browser.pane.unsupported" }])
  })

  test("decodes this connection's handshake and requests and ignores other connections", () => {
    expect(frame({ type: "attached", connectionID: "other", version: 5 })).toEqual({ kind: "foreign" })
    expect(frame({ type: "attached", connectionID, version: 4 })).toEqual({ kind: "attached" })
    expect(frame({ type: "command", connectionID, requestID: "r1" })).toEqual({ kind: "command", requestID: "r1" })
    expect(frame({ type: "cancel", connectionID, requestID: "r1" })).toEqual({ kind: "cancel", requestID: "r1" })
  })
})

describe("binding close reason", () => {
  test("the first close reason wins over every later one", () => {
    const replaced = play(attached(), on({ type: "attachment.ended", outcome: "replaced" }))
    expect(closeEvents(replaced.effects)).toEqual([{ state: null, error: "browser.pane.replaced" }])

    const later = play(
      replaced.state,
      on({ type: "attachment.ended", outcome: "unavailable" }),
      on({ type: "owner.closed" }),
      on({ type: "client.closed" }),
      on({ type: "register.timed-out" }),
      { type: "disposed" },
    )

    expect(later.effects).toEqual([])

    const closed = transitionBinding(entry(attached()), { type: "attachment.ended", outcome: "replaced" }).state
    expect(transitionBinding(closed, { type: "pane.disposed" })).toEqual({ state: closed, effects: [] })
  })

  test("an unavailable server suspends an attached binding with its tabs and rejects a connecting one", () => {
    const restore = { tabs: [tab(tabA, dashboard)], focusedTabID: tabA }
    const suspended = play(attached(restore), on({ type: "attachment.ended", outcome: "unavailable" }))
    expect(closeEvents(suspended.effects)).toEqual([
      { state: { tabs: [tab(tabA, dashboard, "", 1)], focusedTabID: tabA }, error: "browser.pane.suspended" },
    ])
    expect(suspended.effects.map((effect) => effect.type)).not.toContain("remove-restore")

    const connecting = play(
      createPaneState(),
      registered(restore),
      on({ type: "attachment.ended", outcome: attachmentFailure({ type: "rpc.unavailable", message: "gone" }) }),
    )

    expect(closeEvents(connecting.effects)).toEqual([{ state: null, error: "browser.pane.unsupported" }])
    expect(connecting.effects.at(-1)).toEqual({ type: "teardown", binding: "b1" })
  })

  test("classifies attachment failures", () => {
    expect(attachmentFailure(new SessionNotFoundError({ sessionID: "ses_1", message: "Session not found" }))).toBe(
      "missing",
    )
    expect(attachmentFailure({ type: "rpc.method_not_found" })).toBe("unsupported")
    expect(attachmentFailure({ type: "rpc.invalid_input" })).toBe("unsupported")
    expect(attachmentFailure({ type: "unavailable" })).toBe("closed")
    expect(attachmentFailure(new Error("socket hang up"))).toBe("closed")
  })

  test("a missing session and the window's close forget the saved tabs; other closes keep them", () => {
    const removes = (event: BindingEvent) =>
      play(attached(), on(event)).effects.some((effect) => effect.type === "remove-restore")

    expect(removes({ type: "attachment.ended", outcome: "missing" })).toBe(true)
    expect(removes({ type: "client.closed" })).toBe(true)
    expect(removes({ type: "owner.closed" })).toBe(false)
    expect(removes({ type: "attachment.ended", outcome: "closed" })).toBe(false)
  })

  test("disposing the pane suspends every binding with its tabs and refuses new ones", () => {
    const restore = { tabs: [tab(tabA, dashboard)], focusedTabID: tabA }

    const disposed = play(
      createPaneState(),
      registered(restore, "b1"),
      registered(undefined, "b2"),
      on({ type: "server.attached", fileRoots: [] }, "b2"),
      { type: "disposed" },
    )

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(closeEvents(disposed.effects)).toEqual([
      { state: { tabs: [tab(tabA, dashboard, "", 1)], focusedTabID: tabA }, error: "browser.pane.suspended" },
      { state: { tabs: [], focusedTabID: null }, error: "browser.pane.suspended" },
    ])
    expect(transitionPane(disposed.state, registered())).toEqual({ state: disposed.state, effects: [] })
  })

  test("the registration timeout closes only a binding still connecting", () => {
    const timedOut = play(createPaneState(), registered(), on({ type: "register.timed-out" }))
    expect(closeEvents(timedOut.effects)).toEqual([{ state: null, error: "browser.pane.registration.closed" }])
    expect(timedOut.effects.at(-1)).toEqual({ type: "teardown", binding: "b1" })

    const open = attached()
    expect(transitionPane(open, on({ type: "register.timed-out" }))).toEqual({ state: open, effects: [] })
  })

  test("attaching resolves the registration and reports the restored tabs", () => {
    const next = play(createPaneState(), registered(), on({ type: "server.attached", fileRoots: ["/repo"] }))
    expect(next.effects.map((effect) => effect.type)).toEqual([
      "start-timer",
      "resolve-register",
      "save-restore",
      "report",
    ])
  })
})

describe("tabs", () => {
  test("a crashed page keeps its tab unloaded and loads again as a new attempt", () => {
    const crashed = play(
      liveDashboard(),
      on({ type: "request.started", requestID: "req_1" }),
      on({ type: "request.targeted", requestID: "req_1", tabID: tabA }),
      on({ type: "tab.crashed", tabID: tabA, attempt: 1, tab: tab(tabA, dashboard, "Dashboard", 1) }),
    )

    const binding = entry(crashed.state)
    expect(binding.tabs.get(tabA)).toEqual({
      status: "unloaded",
      tab: { ...tab(tabA, dashboard, "Dashboard", 2), loadError: "page_crashed" },
    })
    expect(binding.focusedTabID).toBe(tabA)
    expect(crashed.effects).toContainEqual({ type: "abort-requests", binding: "b1", requestIDs: ["req_1"] })
    expect(crashed.effects).toContainEqual({ type: "release-pages", binding: "b1", attempts: [1] })
    expect(crashed.effects).toContainEqual({
      type: "save-restore",
      storageKey: "server\nb1",
      snapshot: { tabs: [{ id: tabA, url: dashboard }], focusedTabID: tabA },
    })
    expect(crashed.effects.findLast((effect) => effect.type === "report")).toMatchObject({
      event: { error: "page_crashed" },
    })

    const reloaded = play(
      crashed.state,
      on({ type: "tab.opened", tabID: tabA, attempt: 2, tab: tab(tabA, dashboard, "Dashboard", 2) }),
    )

    expect(entry(reloaded.state).tabs.get(tabA)).toMatchObject({ status: "live", attempt: 2 })
    expect(isCurrentPage(reloaded.state, "b1", tabA, 2)).toBe(true)
  })

  test("a page that crashes before committing its address keeps the last known address", () => {
    const crashed = play(
      liveDashboard(),
      on({ type: "tab.published", tabID: tabA, attempt: 1, tab: tab(tabA, "", "", 2) }),
      on({ type: "tab.crashed", tabID: tabA, attempt: 1, tab: tab(tabA, "", "", 2) }),
    )

    expect(entry(crashed.state).tabs.get(tabA)).toMatchObject({ status: "unloaded", tab: { url: dashboard } })
  })

  test("results from an earlier page of the same tab are ignored", () => {
    const current = play(
      liveDashboard(),
      on({ type: "tab.crashed", tabID: tabA, attempt: 1 }),
      on({ type: "tab.opened", tabID: tabA, attempt: 2, tab: tab(tabA, dashboard, "", 2) }),
    ).state

    ;[
      on({ type: "tab.crashed", tabID: tabA, attempt: 1 }),
      on({ type: "tab.published", tabID: tabA, attempt: 1, tab: tab(tabA, "http://stale.test", "", 9) }),
      on({ type: "tab.opened", tabID: tabA, attempt: 1, tab: tab(tabA, dashboard) }),
    ].forEach((event) => expect(transitionPane(current, event)).toEqual({ state: current, effects: [] }))
    expect(isCurrentPage(current, "b1", tabA, 1)).toBe(false)
  })

  test("an unchanged state is saved but not reported again", () => {
    const published = on({ type: "tab.published", tabID: tabA, attempt: 1, tab: tab(tabA, dashboard, "Dashboard", 1) })
    const again = transitionPane(liveDashboard(), published)
    expect(again.effects.map((effect) => effect.type)).toEqual(["save-restore"])
  })

  test("tab events before the server attaches are ignored", () => {
    const connecting = play(createPaneState(), registered()).state
    const event = on({ type: "tab.opened", tabID: tabA, attempt: 1, tab: tab(tabA, dashboard) })
    expect(transitionPane(connecting, event)).toEqual({ state: connecting, effects: [] })
  })
})

describe("focus", () => {
  test("a restored focus that names no tab falls back to the first tab, or none", () => {
    const stale = attached({ tabs: [tab(tabA, dashboard)], focusedTabID: missing })
    expect(entry(stale).focusedTabID).toBe(tabA)
    expect(entry(attached({ tabs: [], focusedTabID: missing })).focusedTabID).toBeNull()
    expect(transitionPane(stale, on({ type: "tab.focused", tabID: missing }))).toEqual({ state: stale, effects: [] })
  })

  test("closing the focused tab focuses the next one and aborts only its requests", () => {
    const closed = play(
      attached({ tabs: [tab(tabA, dashboard), tab(tabB, "http://b.test")], focusedTabID: tabA }),
      on({ type: "tab.opened", tabID: tabA, attempt: 1, tab: tab(tabA, dashboard) }),
      on({ type: "request.started", requestID: "on-a" }),
      on({ type: "request.targeted", requestID: "on-a", tabID: tabA }),
      on({ type: "request.started", requestID: "on-b" }),
      on({ type: "request.targeted", requestID: "on-b", tabID: tabB }),
      on({ type: "tab.closed", tabID: tabA }),
    )

    const binding = entry(closed.state)
    expect(binding.focusedTabID).toBe(tabB)
    expect(Array.from(binding.tabs.keys())).toEqual([tabB])
    expect(closed.effects).toContainEqual({ type: "abort-requests", binding: "b1", requestIDs: ["on-a"] })
    expect(closed.effects).toContainEqual({ type: "release-pages", binding: "b1", attempts: [1] })
    expect(binding.status === "attached" && Array.from(binding.requests.keys())).toEqual(["on-b"])
  })
})
