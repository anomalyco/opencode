import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { HomeSessionRecord } from "./records"
import {
  HOME_SESSION_LOOKUP_TIMEOUT_MS,
  INITIAL_HOME_SESSION_SEARCH_STATE,
  selectSearchExact,
  selectSearchLookingUp,
  selectSearchOpen,
  selectSearchValue,
  transitionHomeSessionSearch,
  type HomeSessionSearchEffect,
  type HomeSessionSearchEvent,
  type HomeSessionSearchState,
} from "./search-machine"

const SESSION_ID = "ses_0123456789abcdefghijklmnop"

const record = (directory: string): HomeSessionRecord => ({
  // SAFETY: the machine stores the record as it is; only its identity matters here.
  session: { id: SESSION_ID, location: { directory } } as SessionInfo,
  project: { id: "proj", worktree: directory },
  projectName: "project",
})

const scope = (value: string, connected = true): HomeSessionSearchEvent => ({
  type: "scope.changed",
  scope: value,
  connected,
})

function replay(events: HomeSessionSearchEvent[], state = INITIAL_HOME_SESSION_SEARCH_STATE) {
  return events.reduce<{ state: HomeSessionSearchState; effects: readonly HomeSessionSearchEffect[] }>(
    (step, event) => transitionHomeSessionSearch(step.state, event),
    { state, effects: [] },
  )
}

describe("home session search machine", () => {
  test("tabbing out closes the results panel and keeps the text; tabbing back reopens it", () => {
    const open = replay([scope("a\0"), { type: "focused" }, { type: "input.changed", value: "jump" }])
    expect(selectSearchOpen(open.state)).toBe(true)

    const blurred = replay([{ type: "blurred" }], open.state)
    expect(selectSearchOpen(blurred.state)).toBe(false)
    expect(selectSearchValue(blurred.state)).toBe("jump")

    expect(selectSearchOpen(replay([{ type: "focused" }], blurred.state).state)).toBe(true)
  })

  test("another server or project drops the exact match and looks the ID up again there", () => {
    const found = replay([
      scope("a\0"),
      { type: "input.changed", value: SESSION_ID },
      { type: "lookup.resolved", attempt: 1, record: record("/a") },
    ])
    expect(selectSearchExact(found.state)).toEqual(record("/a"))

    const moved = replay([scope("b\0")], found.state)
    expect(selectSearchExact(moved.state)).toBeUndefined()
    expect(moved.effects).toEqual([
      { type: "lookup.start", attempt: 2, sessionID: SESSION_ID, timeoutMs: HOME_SESSION_LOOKUP_TIMEOUT_MS },
    ])

    // The first server's late answer cannot land in the second server's search.
    expect(
      transitionHomeSessionSearch(moved.state, { type: "lookup.resolved", attempt: 1, record: record("/a") }).state,
    ).toBe(moved.state)

    const inFlight = replay([scope("c\0")], moved.state)
    expect(inFlight.effects[0]).toEqual({ type: "lookup.abort" })
  })

  test("a session ID is looked up only while the server is connected", () => {
    const text = replay([scope("a\0", true), { type: "input.changed", value: "jump" }])
    expect(text.effects).toEqual([])
    expect(selectSearchLookingUp(text.state)).toBe(false)

    const waiting = replay([scope("a\0", false), { type: "input.changed", value: SESSION_ID }])
    expect(waiting.effects).toEqual([])
    expect(selectSearchLookingUp(waiting.state)).toBe(false)

    const connected = replay([scope("a\0", true)], waiting.state)
    expect(selectSearchLookingUp(connected.state)).toBe(true)

    const dropped = replay([scope("a\0", false)], connected.state)
    expect(selectSearchLookingUp(dropped.state)).toBe(false)
    expect(dropped.effects).toEqual([{ type: "lookup.abort" }])
  })

  test("every lookup ends: found, missing, failed, timed out, closed or disposed", () => {
    const looking = replay([scope("a\0"), { type: "focused" }, { type: "input.changed", value: SESSION_ID }])
    expect(selectSearchLookingUp(looking.state)).toBe(true)

    const missing = replay([{ type: "lookup.resolved", attempt: 1, record: undefined }], looking.state)
    expect(missing.state.status).toBe("idle")

    const failed = replay([{ type: "lookup.failed", attempt: 1 }], looking.state)
    expect(failed.state.status).toBe("idle")
    expect(failed.effects).toEqual([])

    const timedOut = replay([{ type: "lookup.timed-out", attempt: 1 }], looking.state)
    expect(timedOut.state.status).toBe("idle")
    expect(timedOut.effects).toEqual([{ type: "lookup.abort" }])

    const closed = replay([{ type: "closed" }], looking.state)
    expect(closed.state).toMatchObject({ status: "idle", focused: false, value: "" })
    expect(closed.effects).toEqual([{ type: "lookup.abort" }])

    const disposed = replay([{ type: "disposed" }], looking.state)
    expect(disposed.effects).toEqual([{ type: "lookup.abort" }])
    expect(
      transitionHomeSessionSearch(disposed.state, { type: "lookup.resolved", attempt: 1, record: record("/a") }).state,
    ).toBe(disposed.state)
  })
})
