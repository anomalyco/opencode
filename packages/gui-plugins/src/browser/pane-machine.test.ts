import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { createDocumentState, documentTab, transitionDocument } from "./page-machine"
import { invalidReply, wireOutcome, wireState } from "./wire"
import { SessionNotFoundError } from "@opencode/protocol/errors"
import {
  attachmentFailure,
  createPaneState,
  decodeControl,
  decodeControlHeader,
  isCurrentPage,
  resolveControlFrame,
  selectBinding,
  selectInventory,
  selectOwnedBinding,
  transitionBinding,
  transitionPane,
  type BindingEvent,
  type PaneEffect,
  type PaneMachineEvent,
  type PaneState,
  type StoredRestore,
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
  readonly capabilities?: readonly string[]
  readonly requestID?: string
}) {
  return resolveControlFrame(connectionID, decodeControlHeader(data), decodeControl(data))
}

function attached(restore?: Browser.State) {
  return play(createPaneState(), registered(restore), on({ type: "server.attached", fileRoots: [] })).state
}

test("only the registering window owns the binding used to review a conversation link", () => {
  const state = attached()
  expect(selectOwnedBinding(state, 1, "b1")).toBeDefined()
  expect(selectOwnedBinding(state, 2, "b1")).toBeUndefined()
  expect(selectOwnedBinding(state, 1, "missing")).toBeUndefined()
})

test("the saved-tab record after stopping a deferred restore is the original address", () => {
  const prior = tab(tabA, dashboard, "Dashboard", 2)
  const start = attached({ tabs: [prior], focusedTabID: tabA })
  const attempt = entry(start).nextAttempt
  const held = transitionDocument(createDocumentState(prior), { type: "navigation.started", url: dashboard, isMainFrame: true, isSameDocument: false }).state
  const stopped = transitionDocument(held, { type: "navigation.held-stopped", address: dashboard }).state
  const value = documentTab(stopped, { id: tabA, canGoBack: false, canGoForward: false })
  const opened = play(start, on({ type: "tab.opened", tabID: tabA, attempt, tab: prior }))
  const next = play(opened.state, on({ type: "tab.published", tabID: tabA, attempt, tab: value }))
  expect(next.effects).toContainEqual({ type: "save-restore", binding: "b1", storageKey: "server\nb1", snapshot: { tabs: [{ id: tabA, url: dashboard }], focusedTabID: tabA } })
})

test("a refused restore keeps its saved address, reports the reason once and consumes no page attempt", () => {
  const url = "file:///old/project/index.html"
  const start = attached({ tabs: [tab(tabA, url)], focusedTabID: tabA })
  const event = on({ type: "restore.refused", tabID: tabA, reason: "browser.restore.outside" })
  const result = transitionPane(start, event)
  expect(entry(result.state).tabs.get(tabA)).toMatchObject({ status: "unloaded", tab: {url, loadError:"browser.restore.outside"} })
  expect(entry(result.state).nextAttempt).toBe(entry(start).nextAttempt)
  expect(transitionPane(result.state, event)).toEqual({state:result.state, effects:[]})
})

test("agent activity neither selects the person's tab nor gives another window a binding", () => {
  const start = attached({ tabs: [tab(tabA, dashboard, "A"), tab(tabB, dashboard, "B")], focusedTabID: tabA })
  const next = transitionPane(start, on({ type: "tab.active", tabID: tabB }))
  const own = selectOwnedBinding(next.state, 1, "b1")

  if (!own) throw new Error("missing fixture binding")
  expect(selectOwnedBinding(next.state, 2, "b1")).toBeUndefined()
  expect(selectInventory(own).focusedTabID).toBe(tabA)
  expect(selectInventory(own, "agent").focusedTabID).toBe(tabB)
  expect(next.effects.some(effect => effect.type === "emit" && effect.event.type === "focus")).toBe(false)
})

test("reconnect tears down the previous native pages before restoring the same window and session", () => {
  const opened = play(attached(), on({type:"tab.opened", tabID: tabA, attempt:1, tab:tab(tabA,"workspace://session/index.html")}))
  const replacement = registered(undefined, "b2")

  if (replacement.type !== "registered") throw new Error("expected registration")
  const next = transitionPane(opened.state, {...replacement, storageKey:"server\nb1"})
  expect(selectBinding(next.state,"b1")).toBeUndefined()
  expect(next.effects.map(effect => effect.type)).toEqual(["emit", "release-pages", "teardown", "start-timer"])
})

// The window registers again with the inventory it last heard, as after its session moves or its server signs in
// again. A tab opened since is not in it, and the new binding started from that inventory alone: the tab left the
// desktop, the saved tabs and the strip, and nobody had closed it.
describe("a registration keeps the tabs the window had not heard of", () => {
  const tabX = Browser.TabID.make("tab_00000000-0000-0000-0000-0000000000cc")
  const heard: Browser.State = { tabs: [tab(tabA, dashboard, "A", 3), tab(tabB, dashboard, "B", 1)], focusedTabID: tabB }
  const again = (saved: StoredRestore = { tabs: [], focusedTabID: null }): PaneMachineEvent => ({ type: "registered", binding: "b2", window: 1, storageKey: "server\nb1", restore: heard, saved })
  const listed = (state: PaneState) => selectInventory(entry(state, "b2")).tabs.map((item) => [item.id, item.title, item.generation])
  // What main saved for the session with its last report.
  const saved = (effects: readonly PaneEffect[]) => effects.flatMap((effect) => (effect.type === "save-restore" ? [effect.snapshot] : [])).at(-1)

  test("a tab opened in the binding it replaces, reported or not, stands after the tab it was opened beside", () => {
    const start = attached(heard)
    // A link in A opens X, which main reports; the report is on its way when the window registers again.
    const opened = play(start, on({ type: "tab.opened", tabID: tabX, attempt: 1, tab: tab(tabX, "about:blank"), beside: { tabID: tabA, front: false } }))
    expect(listed(transitionPane(opened.state, again()).state)).toEqual([[tabA, "A", 4], [tabX, "", 1], [tabB, "B", 2]])
    // One the agent opened says nothing until its page does, or it is shown.
    const quiet = play(start, on({ type: "tab.opened", tabID: tabX, attempt: 1, tab: tab(tabX, "about:blank") }))
    expect(quiet.effects).toEqual([])
    const next = transitionPane(quiet.state, again())
    expect(listed(next.state)).toEqual([[tabA, "A", 4], [tabB, "B", 2], [tabX, "", 1]])
    expect(selectBinding(next.state, "b1")).toBeUndefined()
  })

  test("a tab main saved after the window's last report comes back when the old binding has closed already", () => {
    const start = attached(heard)
    const opened = play(start, on({ type: "tab.opened", tabID: tabX, attempt: 1, tab: tab(tabX, "about:blank"), beside: { tabID: tabA, front: false } }))
    const closed = play(opened.state, on({ type: "owner.closed" }))
    const kept = saved(opened.effects)

    if (!kept) throw new Error("main saved nothing")
    expect(listed(transitionPane(closed.state, again(kept)).state)).toEqual([[tabA, "A", 4], [tabX, "", 1], [tabB, "B", 2]])
    // A tab the person closed before that is in neither, and stays closed.
    const shut = play(opened.state, on({ type: "tab.closed", tabID: tabX }), on({ type: "owner.closed" }))
    const rest = saved(shut.effects)

    if (!rest) throw new Error("main saved nothing")
    expect(listed(transitionPane(shut.state, again(rest)).state)).toEqual([[tabA, "A", 4], [tabB, "B", 2]])
  })
})

test("a restored preview retries the failed attempt when the server returns", () => {
  const state = attached({tabs:[{ ...tab(tabA,"workspace://ses_x/report.html"), loadError:"ERR_FAILED" }], focusedTabID:tabA})
  const restored = entry(state).tabs.get(tabA)?.tab
  expect(restored?.url).toBe("workspace://ses_x/report.html")
  expect(restored?.loadError).toBeUndefined()
  expect(Object.hasOwn(restored ?? {}, "loadError")).toBe(false)
})

test("tab inventories and command replies cross the same JSON boundary, including after restore", () => {
  for (const url of ["about:blank", "file:///project/index.html", "workspace://session/index.html", "artifact://art_report/"]) {
    const failed = { ...tab(tabA, url), loadError: "ERR_FAILED" }
    const restored = entry(attached({tabs:[failed], focusedTabID:tabA})).tabs.get(tabA)!.tab

    for (const t of [failed, restored]) {
      const state = { tabs: [t], focusedTabID: tabA }
      expect(wireState(state)).toEqual(state)
      expect(wireOutcome({type:"success",result:{value:state,files:[]}}).type).toBe("success")
    }
  }

  const invalid = {}
  Object.defineProperty(invalid, "missing", { value: undefined, enumerable: true })
  expect(wireOutcome({ type: "success", result: { value: invalid, files: [] } })).toEqual(invalidReply)
})

test("an offline registration returns the saved inventory for retry without forgetting it", () => {
  const tab = { id: tabA, url: "workspace://ses_x/report.html" }
  const start = registered()

  if (start.type !== "registered") throw new Error("expected registration")
  const result = play(createPaneState(), { ...start, saved: { tabs: [tab], focusedTabID: tabA } }, on({ type: "attachment.ended", outcome: "closed" }))
  expect(closeEvents(result.effects)).toMatchObject([{ state: { tabs: [tab] }, error: "browser.pane.registration.closed" }])
})

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
    expect(frame({ type: "attached", connectionID, version: 4 })).toEqual({ kind: "attached", capabilities: [] })
    expect(frame({ type: "attached", connectionID, version: 4, capabilities: ["tunnel.ws.v1"] })).toEqual({
      kind: "attached",
      capabilities: ["tunnel.ws.v1"],
    })
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

  test("only explicit deletion forgets the saved tabs, not a missing session or suspended window", () => {
    const removes = (event: BindingEvent) =>
      play(attached(), on(event)).effects.some((effect) => effect.type === "remove-restore")

    expect(removes({ type: "attachment.ended", outcome: "missing" })).toBe(false)
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
    // The agent's requests on the tab are aborted with why its page ended, when the page says.
    const ended = { cause: "renderer-gone", reason: "oom", exitCode: -536870904 } as const
    expect(
      play(
        liveDashboard(),
        on({ type: "request.started", requestID: "req_1" }),
        on({ type: "request.targeted", requestID: "req_1", tabID: tabA }),
        on({ type: "tab.crashed", tabID: tabA, attempt: 1, ended }),
      ).effects.find((effect) => effect.type === "abort-requests"),
    ).toEqual({ type: "abort-requests", binding: "b1", requestIDs: ["req_1"], ended })
    expect(crashed.effects).toContainEqual({ type: "release-pages", binding: "b1", attempts: [1] })
    expect(crashed.effects).toContainEqual({
      type: "save-restore",
      binding: "b1",
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

  test("a tab that closes itself gives the pane back to the tab that opened it only when it was in front", () => {
    const tabC = Browser.TabID.make("tab_00000000-0000-0000-0000-00000000000c")
    const tabs = [tab(tabA, dashboard), tab(tabB, "http://b.test"), tab(tabC, "about:blank")]
    const focus = { type: "emit", binding: "b1", event: { type: "focus", tabID: tabB } } as const
    // In front: the opener, not the first tab, and the window hears the selection before the inventory without the tab.
    const front = transitionPane(attached({ tabs, focusedTabID: tabC }), on({ type: "tab.closed", tabID: tabC, opener: tabB }))
    expect(entry(front.state).focusedTabID).toBe(tabB)
    expect(front.effects[0]).toEqual(focus)
    expect(front.effects.findIndex((effect) => effect.type === "report")).toBeGreaterThan(0)
    // Behind: the selection stays where it was, and nothing asks the window to select.
    const behind = transitionPane(attached({ tabs, focusedTabID: tabA }), on({ type: "tab.closed", tabID: tabC, opener: tabB }))
    expect(entry(behind.state).focusedTabID).toBe(tabA)
    expect(behind.effects).not.toContainEqual(focus)
    // An opener that is gone: the first tab, as for any closed tab.
    const orphan = transitionPane(attached({ tabs, focusedTabID: tabC }), on({ type: "tab.closed", tabID: tabC, opener: missing }))
    expect(entry(orphan.state).focusedTabID).toBe(tabA)
    expect(orphan.effects.some((effect) => effect.type === "emit")).toBe(false)
  })
})

describe("position", () => {
  const id = (n: number) => Browser.TabID.make(`tab_00000000-0000-0000-0000-00000000001${n}`)
  const [a, b, c, x, y, z] = [1, 2, 3, 4, 5, 6].map(id)
  const address = "https://docs.example/guide"

  // What a new tab's page reports, in order, as measured in Electron (electron-links.test.ts): its load starts, its
  // document commits under Chromium's name for it, the document names itself, and the load ends.
  const started = (tabID: Browser.TabID): Browser.Tab => ({ ...tab(tabID, "about:blank"), loading: true })
  const committed = (tabID: Browser.TabID): Browser.Tab => ({ ...tab(tabID, address, "docs.example/guide", 1), loading: true })
  const titled = (tabID: Browser.TabID): Browser.Tab => ({ ...tab(tabID, address, "Guide", 1), loading: true })
  const ended = (tabID: Browser.TabID, title = "Guide"): Browser.Tab => tab(tabID, address, title, 1)

  type Step =
    /** A tab opens: from `from`'s page or link, behind it or in `front`; with no `from`, by "+" or the agent. */
    | { readonly open: Browser.TabID; readonly from?: Browser.TabID; readonly front?: boolean }
    /** The tab's page reports itself. */
    | { readonly report: Browser.Tab }
    /** The person selects a tab in the strip. */
    | { readonly select: Browser.TabID }
    | { readonly close: Browser.TabID }
    /** The person types an address into a tab. */
    | { readonly address: Browser.TabID }

  // A tab opened from `from`, whose page then loads and names itself.
  const named = (tabID: Browser.TabID, from: Browser.TabID, front = false): Step[] => [
    { open: tabID, from, front },
    { report: started(tabID) },
    { report: committed(tabID) },
    { report: titled(tabID) },
  ]

  const event = (state: PaneState, step: Step): BindingEvent => {
    if ("report" in step) {
      const slot = entry(state).tabs.get(step.report.id)

      return { type: "tab.published", tabID: step.report.id, attempt: slot?.status === "live" ? slot.attempt : -1, tab: step.report }
    }

    if ("select" in step) return { type: "tab.focused", tabID: step.select, fromStrip: true }

    if ("close" in step) return { type: "tab.closed", tabID: step.close }

    if ("address" in step) return { type: "tab.addressed", tabID: step.address }

    return {
      type: "tab.opened",
      tabID: step.open,
      attempt: entry(state).nextAttempt,
      tab: tab(step.open, "about:blank"),
      beside: step.from ? { tabID: step.from, front: !!step.front } : undefined,
    }
  }

  // Three tabs with B in front, then the steps. `strip`: the tabs in the order the binding lists them. `placed`: each
  // tab the strip was told to add beside another, with that other. `unnamed`: which tabs each report said keep their
  // new-tab label, one entry per change, so a tab that is relabelled once leaves it once.
  const run = (steps: readonly Step[]) => {
    const start = attached({ tabs: [a, b, c].map((tabID) => tab(tabID, dashboard)), focusedTabID: b })
    const reports: Extract<PaneEffect, { type: "report" }>["event"][] = []

    const end = steps.reduce(
      (last, step) => {
        const opened = transitionPane(last.state, on(event(last.state, step)))
        // The pane brings a tab that opened in front to the front itself, right after; that is not the person's selection.
        const next = "open" in step && (step.front || !step.from) ? play(opened.state, on({ type: "tab.focused", tabID: step.open })) : { state: opened.state, effects: [] }

        return { state: next.state, reports: [...last.reports, ...[...opened.effects, ...next.effects].flatMap((effect) => (effect.type === "report" ? [effect.event] : []))] }
      },
      { state: start, reports },
    )

    return {
      strip: Array.from(entry(end.state).tabs.keys()),
      placed: end.reports.flatMap((report) => (report.placed ? [[report.placed.tabID, report.placed.after]] : [])),
      unnamed: end.reports.map((report) => report.unnamed ?? []).filter((list, index, all) => index === 0 || list.join() !== all[index - 1].join()),
      front: entry(end.state).focusedTabID,
    }
  }

  type Row = readonly [name: string, steps: readonly Step[], strip: readonly Browser.TabID[], placed: readonly (readonly Browser.TabID[])[], unnamed: readonly (readonly Browser.TabID[])[], front?: Browser.TabID]

  // When the strip shows a tab a link opened, and how long it keeps its new-tab label: until its page names itself.
  const shown: readonly Row[] = [
    ["a tab a link opens behind is listed at once, right after the tab it came from, with its new-tab label", [{ open: x, from: b }], [a, b, x, c], [[x, b]], [[x]]],
    [
      "it keeps that label while its load starts and its document has only Chromium's name, its address",
      [{ open: x, from: b }, { report: started(x) }, { report: committed(x) }],
      [a, b, x, c],
      [[x, b]],
      [[x]],
    ],
    ["it takes its page's title once, when its document names itself", named(x, b), [a, b, x, c], [[x, b]], [[x], []]],
    ["and nothing more as its load ends", [...named(x, b), { report: ended(x) }], [a, b, x, c], [[x, b]], [[x], []]],
    [
      "a document with no title is named when its load ends, with Chromium's name",
      [{ open: x, from: b }, { report: started(x) }, { report: committed(x) }, { report: ended(x, "docs.example/guide") }],
      [a, b, x, c],
      [[x, b]],
      [[x], []],
    ],
    [
      "a load that fails keeps the label at its error, which has no name yet",
      [{ open: x, from: b }, { report: started(x) }, { report: { ...ended(x, ""), loadError: "ERR_CONNECTION_REFUSED" } }],
      [a, b, x, c],
      [[x, b]],
      [[x]],
    ],
    [
      "and is named a moment later, once",
      [{ open: x, from: b }, { report: started(x) }, { report: { ...ended(x, ""), loadError: "ERR_CONNECTION_REFUSED" } }, { report: { ...ended(x, "docs.example/guide"), loadError: "ERR_CONNECTION_REFUSED" } }],
      [a, b, x, c],
      [[x, b]],
      [[x], []],
    ],
    [
      "a load that ends with no document, as for a refused address, is a new tab that waits for nothing",
      [{ open: x, from: b }, { report: started(x) }, { report: tab(x, "about:blank") }],
      [a, b, x, c],
      [[x, b]],
      [[x], []],
    ],
    ["a tab that closes before its page has a name leaves no label behind", [{ open: x, from: b }, { report: started(x) }, { close: x }], [a, b, c], [[x, b]], [[x], []]],
    ["a tab opened in front is listed and takes the pane at once", [{ open: x, from: b, front: true }], [a, b, x, c], [[x, b]], [[x]], x],
    ["and takes its page's title once, as one opened behind does", named(x, b, true), [a, b, x, c], [[x, b]], [[x], []], x],
    [
      "two opened behind are listed in the order they were opened, and each is named once, whichever page is named first",
      [{ open: x, from: b }, { open: y, from: b }, { report: started(x) }, { report: started(y) }, { report: committed(y) }, { report: titled(y) }, { report: committed(x) }, { report: titled(x) }],
      [a, b, x, y, c],
      [[x, b], [y, x]],
      [[x], [x, y], [x], []],
    ],
    ['a tab the person adds with "+", or the agent opens, goes to the end with no label to keep', [{ open: x }, { report: started(x) }, { report: committed(x) }], [a, b, c, x], [], [[]], x],
  ]

  // Where it stands: Chrome's rule (tab-openers.ts). Each tab's page is named before the next step.
  const placed: readonly Row[] = [
    [
      "several opened behind in a row stand in the order they were opened",
      [...named(x, b), ...named(y, b), ...named(z, b)],
      [a, b, x, y, z, c],
      [[x, b], [y, x], [z, y]],
      [[x], [], [y], [], [z], []],
    ],
    [
      "a tab that opens in front stands right after the tab it came from, before those opened behind",
      [...named(x, b), ...named(y, b), ...named(z, b, true)],
      [a, b, z, x, y, c],
      [[x, b], [y, x], [z, b]],
      [[x], [], [y], [], [z], []],
      z,
    ],
    [
      "a tab opened from a tab that was opened behind joins the same row",
      [...named(x, b), { select: x }, ...named(y, x), { select: b }, ...named(z, b)],
      [a, b, x, y, z, c],
      [[x, b], [y, x], [z, y]],
      [[x], [], [y], [], [z], []],
    ],
    [
      "looking at an unrelated tab from the opener and coming back keeps the row, as in Chrome",
      [...named(x, b), { select: a }, { select: b }, ...named(y, b)],
      [a, b, x, y, c],
      [[x, b], [y, x]],
      [[x], [], [y], []],
    ],
    [
      "going from a tab the row opened to an unrelated tab ends the row",
      [...named(x, b), { select: x }, { select: a }, { select: b }, ...named(y, b)],
      [a, b, y, x, c],
      [[x, b], [y, b]],
      [[x], [], [y], []],
    ],
    [
      "a tab opened in front ends the rows before it",
      [...named(x, b), ...named(y, b, true), { select: b }, ...named(z, b)],
      [a, b, y, z, x, c],
      [[x, b], [y, b], [z, y]],
      [[x], [], [y], [], [z], []],
    ],
    [
      "what a closed tab opened counts as opened by that tab's own opener",
      [...named(x, b), { select: x }, ...named(y, x), { close: x }, { select: b }, ...named(z, b)],
      [a, b, y, z, c],
      [[x, b], [y, x], [z, y]],
      [[x], [], [y], [], [z], []],
    ],
    ["a tab whose opener closed meanwhile goes to the end", [{ close: b }, { open: x, from: b }], [a, c, x], [], [[]], a],
    [
      "an address typed into a tab ends the row",
      [...named(x, b), { address: b }, ...named(y, b)],
      [a, b, y, x, c],
      [[x, b], [y, b]],
      [[x], [], [y], []],
    ],
    [
      "but not the first address typed into a new tab at the end, a quick look-up",
      [...named(x, b), { open: y }, { address: y }, { select: b }, ...named(z, b)],
      [a, b, x, z, c, y],
      [[x, b], [z, x]],
      [[x], [], [z], []],
    ],
  ]

  test.each([...shown, ...placed])("%s", (_name, steps, strip, placed, unnamed, front = b) => {
    expect(run(steps)).toEqual({ strip: [...strip], placed: placed.map((item) => [...item]), unnamed: unnamed.map((item) => [...item]), front })
  })

  test("a tab opened in front is reported with its place before the window is asked to select it", () => {
    const start = attached({ tabs: [a, b, c].map((tabID) => tab(tabID, dashboard)), focusedTabID: b })
    const opened = transitionPane(start, on(event(start, { open: x, from: b, front: true })))
    const focused = transitionPane(opened.state, on({ type: "tab.focused", tabID: x }))
    expect(opened.effects.flatMap((effect) => (effect.type === "report" ? [effect.event.placed] : []))).toEqual([{ tabID: x, after: b }])
    expect(focused.effects.at(-1)).toEqual({ type: "emit", binding: "b1", event: { type: "focus", tabID: x } })
  })

  test("a tab the binding lists already keeps its place when its page loads again", () => {
    const start = attached({ tabs: [a, b, c].map((tabID) => tab(tabID, dashboard)), focusedTabID: a })
    const loaded = transitionPane(start, on({ type: "tab.opened", tabID: c, attempt: 1, tab: tab(c, dashboard), beside: { tabID: a, front: false } }))
    expect(Array.from(entry(loaded.state).tabs.keys())).toEqual([a, b, c])
    expect(loaded.effects).toEqual([])
  })
})
