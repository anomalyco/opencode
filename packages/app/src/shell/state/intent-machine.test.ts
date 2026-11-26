import { describe, expect, test } from "bun:test"
import {
  createLayoutIntentState,
  selectNavigationIntent,
  selectPaneTarget,
  transitionLayoutIntent,
  type LayoutIntentEvent,
  type LayoutIntentState,
} from "./intent-machine"
import { placeSessionTabs } from "./session-tabs"
import type { LayoutRoute } from "./layout"

const replay = (events: LayoutIntentEvent[], state = createLayoutIntentState()) =>
  events.reduce((current, event) => transitionLayoutIntent(current, event).state, state)

const HOME: LayoutRoute = { type: "home" }

const SETTINGS: LayoutRoute = { type: "settings" }

// The route the shortcut is pressed on.
const ORIGIN: LayoutRoute = { type: "draft", draftID: "origin" }

const draft = (draftID: string): LayoutRoute => ({ type: "draft", draftID })

const route = (value: LayoutRoute): LayoutIntentEvent => ({ type: "route.synced", route: value })

const attemptOf = (state: LayoutIntentState) =>
  state.status === "active" && state.navigation.kind !== "none" ? state.navigation.attempt : 0

describe("draft project search", () => {
  test("a plain draft opened while another draft loads does not open the project picker", () => {
    const requested = replay([
      { type: "draft-search.requested", draftID: "a", currentRoute: ORIGIN },
      route(draft("a")),
    ])

    // ⌘T opens draft b before draft a's composer is ready.
    expect(selectNavigationIntent(requested, "draft-project-search", draft("b"))).toBeUndefined()
    const left = replay([route(draft("b"))], requested)
    expect(selectNavigationIntent(left, "draft-project-search", draft("a"))).toBeUndefined()
    expect(selectNavigationIntent(left, "draft-project-search", draft("b"))).toBeUndefined()
  })

  test("waits on the shortcut's route until the navigation commits, then for the draft to mount", () => {
    const requested = transitionLayoutIntent(createLayoutIntentState(), {
      type: "draft-search.requested",
      draftID: "a",
      currentRoute: ORIGIN,
    })

    expect(requested.effects).toEqual([{ type: "nav-timer.start", attempt: 1, timeoutMs: 5_000 }])

    const committing = replay([route(ORIGIN)], requested.state)
    expect(committing).toBe(requested.state)

    const entered = transitionLayoutIntent(committing, route(draft("a")))
    expect(entered.effects).toEqual([{ type: "nav-timer.clear" }])
    const intent = selectNavigationIntent(entered.state, "draft-project-search", draft("a"))
    expect(intent).toBeDefined()

    const taken = replay([{ type: "navigation.taken", attempt: intent!.attempt }], entered.state)
    expect(selectNavigationIntent(taken, "draft-project-search", draft("a"))).toBeUndefined()
  })

  test("expires when the navigation never arrives, and a stale timer leaves a newer intent alone", () => {
    const first = replay([{ type: "draft-search.requested", draftID: "a", currentRoute: ORIGIN }])
    const second = replay([{ type: "draft-search.requested", draftID: "b", currentRoute: ORIGIN }], first)

    const stale = replay([{ type: "navigation.expired", attempt: attemptOf(first) }], second)
    expect(stale).toBe(second)

    const expired = replay([{ type: "navigation.expired", attempt: attemptOf(second) }], second)
    expect(selectNavigationIntent(expired, "draft-project-search", draft("b"))).toBeUndefined()
  })
})

describe("home search focus", () => {
  test("a Home visit after a superseded or blocked shortcut does not take focus", () => {
    const requested = replay([{ type: "home-search.requested", currentRoute: ORIGIN }])

    // Another navigation overtakes the shortcut's.
    const superseded = replay([route(SETTINGS), route(HOME)], requested)
    expect(selectNavigationIntent(superseded, "home-search", HOME)).toBeUndefined()

    // The navigation never commits.
    const blocked = replay([{ type: "navigation.expired", attempt: attemptOf(requested) }, route(HOME)], requested)
    expect(selectNavigationIntent(blocked, "home-search", HOME)).toBeUndefined()
  })

  test("Home that mounts late, e.g. behind a plugin's server cover, still takes it while the route stays", () => {
    const entered = replay([{ type: "home-search.requested", currentRoute: ORIGIN }, route(HOME)])

    expect(selectNavigationIntent(entered, "home-search", HOME)).toBeDefined()
    expect(selectNavigationIntent(replay([route(ORIGIN)], entered), "home-search", HOME)).toBeUndefined()
  })
})

describe("pane targets", () => {
  test("a pending terminal launch does not pull a file into the bottom pane", () => {
    const targeted = replay([{ type: "pane.targeted", session: "s", pane: "bottom", plugin: "terminal" }])
    const target = selectPaneTarget(targeted, "s")

    const file = placeSessionTabs(
      { all: ["file:a"] },
      { all: ["file:a", "file://b.ts"], active: "file://b.ts" },
      target,
    )

    expect(file.panes).toBeUndefined()

    const terminal = placeSessionTabs(
      { all: ["file:a"] },
      { all: ["file:a", "terminal:1"], active: "terminal:1" },
      target,
    )

    expect(terminal.panes).toEqual({ "terminal:1": "bottom" })
  })

  test("expires, is consumed once, and only by its own attempt", () => {
    const first = replay([{ type: "pane.targeted", session: "s", pane: "bottom", plugin: "terminal" }])
    const firstAttempt = selectPaneTarget(first, "s")!.attempt
    const second = replay([{ type: "pane.targeted", session: "s", pane: "split", plugin: "browser" }], first)

    expect(replay([{ type: "pane.expired", session: "s", attempt: firstAttempt }], second)).toBe(second)

    const consumed = transitionLayoutIntent(second, {
      type: "pane.consumed",
      session: "s",
      attempt: selectPaneTarget(second, "s")!.attempt,
    })

    expect(selectPaneTarget(consumed.state, "s")).toBeUndefined()
    expect(consumed.effects).toEqual([{ type: "pane-timer.clear", sessions: ["s"] }])

    const expired = replay([{ type: "pane.expired", session: "s", attempt: firstAttempt }], first)
    expect(selectPaneTarget(expired, "s")).toBeUndefined()
  })

  test("pruning a session and disposing clear its target and timer", () => {
    const targeted = replay([
      { type: "pane.targeted", session: "s", pane: "bottom" },
      { type: "pane.targeted", session: "t", pane: "split" },
    ])

    const pruned = transitionLayoutIntent(targeted, { type: "sessions.pruned", keys: ["s", "u"] })
    expect(selectPaneTarget(pruned.state, "s")).toBeUndefined()
    expect(selectPaneTarget(pruned.state, "t")).toBeDefined()
    expect(pruned.effects).toEqual([{ type: "pane-timer.clear", sessions: ["s"] }])

    const disposed = transitionLayoutIntent(pruned.state, { type: "disposed" })
    expect(disposed.effects).toEqual([{ type: "nav-timer.clear" }, { type: "pane-timer.clear", sessions: ["t"] }])
    expect(replay([{ type: "pane.targeted", session: "s", pane: "bottom" }], disposed.state)).toBe(disposed.state)
  })
})
