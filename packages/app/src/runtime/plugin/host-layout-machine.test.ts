import { expect, test } from "bun:test"
import {
  createMobileViewState,
  createProjectRequestState,
  createSideRegionState,
  MOBILE_VIEW_PENDING_TTL_MS,
  PROJECT_REQUEST_TTL_MS,
  selectMobileView,
  selectSideRegionSession,
  transitionMobileView,
  transitionProjectRequest,
  transitionSideRegion,
  type MobileViewEvent,
  type MobileViewState,
  type ProjectRequestEvent,
  type ProjectRequestState,
  type SideRegionEvent,
  type SideRegionState,
} from "./host-layout-machine"

const s = "server\nses_a"

function fold<S, E, X>(transition: (state: S, event: E) => { state: S; effects: readonly X[] }, initial: S) {
  const machine = { state: initial }
  const effects: X[] = []

  const dispatch = (event: E) => {
    const next = transition(machine.state, event)

    machine.state = next.state
    effects.push(...next.effects)

    return next
  }

  return { machine, effects, dispatch }
}

const side = () => fold<SideRegionState, SideRegionEvent, unknown>(transitionSideRegion, createSideRegionState())

const toggled = { type: "panel.opened", session: s, key: "context:main", via: "toggle", placement: "open" } as const

// Before, `Layout.open` never cleared the toggle's ownership, so toggling the first panel off shut the region over the
// panel opened after it.
test("a panel opened into a region a toggle opened makes the region the user's", () => {
  const run = side()

  run.dispatch({ ...toggled, wasOpen: false, nowOpen: true })
  expect(selectSideRegionSession(run.machine.state, s)).toEqual({ status: "open-for-panel", key: "context:main" })

  run.dispatch({ type: "panel.opened", session: s, key: "review:review", via: "open", placement: "open", wasOpen: true, nowOpen: true })
  run.dispatch({ type: "panel.closed", session: s, key: "context:main", empty: true })

  expect(selectSideRegionSession(run.machine.state, s)).toEqual({ status: "open-user" })
  expect(run.effects).toEqual([])
})

// Before, ownership hung off a token minted from `sessions()`, so a session that dropped out of it while its server
// signed in again came back with a new token and lost its owner.
test("a sync that still lists the open region keeps its owner, and only a close forgets it", () => {
  const run = side()

  run.dispatch({ ...toggled, wasOpen: false, nowOpen: true })
  const owned = run.machine.state

  expect(run.dispatch({ type: "sync", opened: new Set([s]) }).state).toBe(owned)
  run.dispatch({ type: "panel.closed", session: s, key: "context:main", empty: true })
  expect(run.effects).toEqual([{ type: "close.side", session: s }])

  run.dispatch({ ...toggled, wasOpen: false, nowOpen: true })
  run.dispatch({ type: "sync", opened: new Set() })
  run.dispatch({ type: "sync", opened: new Set([s]) })
  expect(selectSideRegionSession(run.machine.state, s)).toEqual({ status: "open-user" })
})

test("a quiet append, or reopening the owner panel, keeps the region the panel's", () => {
  const run = side()

  run.dispatch({ ...toggled, wasOpen: false, nowOpen: true })
  const owned = run.machine.state

  run.dispatch({ type: "panel.opened", session: s, key: "review:review", via: "open", placement: "append", wasOpen: true, nowOpen: true })
  run.dispatch({ type: "panel.opened", session: s, key: "context:main", via: "open", placement: "open", wasOpen: true, nowOpen: true })
  expect(run.machine.state).toBe(owned)

  run.dispatch({ ...toggled, wasOpen: true, nowOpen: true })
  expect(selectSideRegionSession(run.machine.state, s)).toEqual({ status: "open-user" })
})

const mobile = () => fold<MobileViewState, MobileViewEvent, unknown>(transitionMobileView, createMobileViewState())

// Before, a view selected for a session that was not routed waited for the next visit forever, so tapping that session
// minutes later opened Files instead of the conversation.
test("a pending narrow-screen view expires, and a visit to another session drops it", () => {
  const expired = mobile()

  expired.dispatch({ type: "select", session: s, view: "file:files", routed: undefined })
  expired.dispatch({ type: "expire", attempt: 1 })
  expired.dispatch({ type: "route.changed", routed: s })
  expect(selectMobileView(expired.machine.state, s)).toBe("session")
  expect(expired.effects).toEqual([{ type: "schedule.expire", attempt: 1, timeoutMs: MOBILE_VIEW_PENDING_TTL_MS }])

  const elsewhere = mobile()

  elsewhere.dispatch({ type: "select", session: s, view: "file:files", routed: undefined })
  elsewhere.dispatch({ type: "route.changed", routed: "server\nses_b" })
  elsewhere.dispatch({ type: "route.changed", routed: s })
  expect(selectMobileView(elsewhere.machine.state, s)).toBe("session")
})

test("a pending view becomes the view of the visit that routes its session, until the next visit", () => {
  const run = mobile()

  run.dispatch({ type: "select", session: s, view: "file:files", routed: undefined })
  run.dispatch({ type: "route.changed", routed: s })
  const active = run.machine.state

  expect(selectMobileView(active, s)).toBe("file:files")
  expect(run.dispatch({ type: "expire", attempt: 1 }).state).toBe(active)
  run.dispatch({ type: "route.changed", routed: undefined })
  expect(selectMobileView(run.machine.state, s)).toBe("session")
  expect(run.effects).toEqual([
    { type: "schedule.expire", attempt: 1, timeoutMs: MOBILE_VIEW_PENDING_TTL_MS },
    { type: "cancel.expire" },
  ])
})

test("disposing cancels a pending view's timer", () => {
  const run = mobile()

  run.dispatch({ type: "select", session: s, view: "file:files", routed: undefined })
  run.dispatch({ type: "disposed" })
  const disposed = run.machine.state

  expect(run.dispatch({ type: "route.changed", routed: s }).state).toBe(disposed)
  expect(run.effects.at(-1)).toEqual({ type: "cancel.expire" })
})

const project = () =>
  fold<ProjectRequestState, ProjectRequestEvent, unknown>(transitionProjectRequest, createProjectRequestState())

// Before, every request waited for its server forever, so clicking twice while an SSH server connected opened two
// pickers, and one for a server that never connected popped up whenever it later did.
test("a newer open-project request replaces one that waits, and an expired one opens nothing", () => {
  const run = project()

  run.dispatch({ type: "request", server: "ssh:a", title: "Open", listed: false })
  run.dispatch({ type: "request", server: "ssh:a", title: "Open", listed: false })
  run.dispatch({ type: "server.listed", server: "ssh:a" })
  run.dispatch({ type: "server.listed", server: "ssh:a" })

  expect(run.effects).toEqual([
    { type: "schedule.expire", attempt: 1, timeoutMs: PROJECT_REQUEST_TTL_MS },
    { type: "cancel.expire" },
    { type: "schedule.expire", attempt: 2, timeoutMs: PROJECT_REQUEST_TTL_MS },
    { type: "cancel.expire" },
    { type: "open.picker", server: "ssh:a", title: "Open" },
  ])

  const stale = project()

  stale.dispatch({ type: "request", server: "ssh:b", title: "Open", listed: false })
  stale.dispatch({ type: "expire", attempt: 1 })
  stale.dispatch({ type: "server.listed", server: "ssh:b" })
  expect(stale.effects).toEqual([{ type: "schedule.expire", attempt: 1, timeoutMs: PROJECT_REQUEST_TTL_MS }])
})

test("a request for a listed server opens the picker at once", () => {
  const run = project()
  const idle = run.machine.state

  expect(run.dispatch({ type: "request", server: "local", title: "Open", listed: true }).state).toBe(idle)
  run.dispatch({ type: "disposed" })
  run.dispatch({ type: "request", server: "local", title: "Open", listed: true })
  expect(run.effects).toEqual([{ type: "open.picker", server: "local", title: "Open" }])
})
