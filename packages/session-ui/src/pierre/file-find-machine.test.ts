import { describe, expect, test } from "bun:test"
import {
  createFindHostRegistryState,
  INITIAL_FILE_FIND_STATE,
  selectShortcutHost,
  transitionFileFind,
  transitionFindHostRegistry,
  viewFileFind,
  type FileFindEffect,
  type FileFindEvent,
  type FileFindState,
  type FindHostRegistryEvent,
  type FindHostRegistryState,
} from "./file-find-machine"

const OPEN = { type: "open.requested", preferredRenderer: "highlights" } as const

function replay(events: FileFindEvent<string>[], state: FileFindState<string> = INITIAL_FILE_FIND_STATE) {
  return events.reduce<{ state: FileFindState<string>; effects: FileFindEffect<string>[] }>(
    (current, event) => {
      const next = transitionFileFind(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const measured = (attempt: number, matches: string[], cursor: "reset" | "keep" | { step: 1 | -1 } = "reset") =>
  ({ type: "matches.measured", attempt, matches, cursor, scroll: true, preferredRenderer: "highlights" }) as const

// Open with query "a" and four matches, the third current.
const searching = replay([
  OPEN,
  { type: "query.changed", query: "a" },
  measured(1, ["a0", "a1", "a2", "a3"]),
  { type: "next.requested", dir: 1, stale: false },
  { type: "next.requested", dir: 1, stale: false },
]).state

describe("transitionFileFind", () => {
  test("a focus frame that lands after close does nothing", () => {
    const opened = transitionFileFind(INITIAL_FILE_FIND_STATE, OPEN)

    expect(opened.effects).toEqual([{ type: "activate-host" }, { type: "schedule-focus", attempt: 1 }])

    const closed = transitionFileFind(opened.state, { type: "close.requested" })

    expect(closed.effects).toEqual([{ type: "cancel-frames" }, { type: "clear-marks" }, { type: "deactivate-host" }])

    const late = transitionFileFind(closed.state, { type: "focus.frame", attempt: 1 })

    expect(late.state).toBe(closed.state)
    expect(late.effects).toEqual([])
  })

  test("opening again cancels the earlier focus frame and keeps the query", () => {
    const again = transitionFileFind(searching, OPEN)

    expect(again.effects).toEqual([
      { type: "activate-host" },
      { type: "cancel-focus" },
      { type: "schedule-focus", attempt: 2 },
    ])
    expect(transitionFileFind(again.state, { type: "focus.frame", attempt: 1 }).effects).toEqual([])
    expect(transitionFileFind(again.state, { type: "focus.frame", attempt: 2 }).effects).toEqual([
      { type: "scan", attempt: 2, query: "a", cursor: "keep", scroll: true },
      { type: "focus-input" },
    ])
    expect(viewFileFind(again.state)).toMatchObject({ open: true, query: "a", count: 4, index: 2 })
  })

  test("a highlight fallback while stepping keeps the current match", () => {
    expect(searching).toMatchObject({ index: 2, renderer: "highlights" })

    const fallback = transitionFileFind(searching, { type: "highlights.failed", attempt: 1 })

    expect(fallback.state).toMatchObject({ index: 2, renderer: "overlay", matches: ["a0", "a1", "a2", "a3"] })
    expect(fallback.effects).toEqual([
      { type: "render-marks", attempt: 1, renderer: "overlay", matches: ["a0", "a1", "a2", "a3"], index: 2 },
    ])
    expect(transitionFileFind(fallback.state, { type: "highlights.failed", attempt: 1 }).state).toBe(fallback.state)
  })

  test("stepping over detached matches scans again and steps from the current index", () => {
    const stale = transitionFileFind(searching, { type: "next.requested", dir: 1, stale: true })

    expect(stale.state).toBe(searching)
    expect(stale.effects).toEqual([{ type: "scan", attempt: 1, query: "a", cursor: { step: 1 }, scroll: true }])

    const fresh = transitionFileFind(searching, measured(1, ["b0", "b1", "b2", "b3", "b4"], { step: 1 }))

    expect(fresh.state).toMatchObject({ index: 3, matches: ["b0", "b1", "b2", "b3", "b4"] })
    expect(fresh.effects).toEqual([
      { type: "render-marks", attempt: 1, renderer: "highlights", matches: ["b0", "b1", "b2", "b3", "b4"], index: 3 },
      { type: "scroll-to-match", match: "b3" },
    ])

    // Fewer rows drawn now: the step starts from the last one and wraps.
    expect(transitionFileFind(searching, measured(1, ["c0", "c1"], { step: 1 })).state).toMatchObject({ index: 0 })
  })

  test("an empty query clears the marks, and a refresh keeps the index", () => {
    const cleared = transitionFileFind(searching, { type: "query.changed", query: "  " })

    expect(cleared.effects).toEqual([{ type: "clear-marks" }])
    expect(viewFileFind(cleared.state)).toMatchObject({ count: 0, index: 0 })
    expect(transitionFileFind(cleared.state, { type: "refresh.requested", reset: true, scroll: false }).state).toBe(
      cleared.state,
    )
    expect(transitionFileFind(searching, { type: "refresh.requested", reset: false, scroll: false }).effects).toEqual([
      { type: "scan", attempt: 1, query: "a", cursor: "keep", scroll: false },
    ])
  })

  test("a closed or disposed bar ignores everything but open and dispose", () => {
    const closed: FileFindState<string> = INITIAL_FILE_FIND_STATE

    for (const event of [
      { type: "query.changed", query: "a" },
      { type: "next.requested", dir: 1, stale: false },
      measured(0, ["a"]),
      { type: "position.updated", pos: { top: 1, right: 1 } },
      { type: "close.requested" },
    ] as const)
      expect(transitionFileFind(closed, event).state).toBe(closed)

    const disposed = transitionFileFind(searching, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "cancel-frames" }, { type: "clear-marks" }, { type: "unregister-host" }])
    expect(transitionFileFind(disposed.state, OPEN).state).toBe(disposed.state)
  })
})

describe("transitionFindHostRegistry", () => {
  function replayRegistry(events: FindHostRegistryEvent<string>[], state = createFindHostRegistryState<string>()) {
    return events.reduce((current, event) => transitionFindHostRegistry(current, event).state, state)
  }

  const registered = replayRegistry([
    { type: "host.registered", host: "a" },
    { type: "host.registered", host: "b" },
    { type: "host.activated", host: "a" },
  ])

  test("opening a second bar closes the first, and the first's late close leaves it alone", () => {
    const switched = transitionFindHostRegistry(registered, { type: "host.activated", host: "b" })

    expect(switched.effects).toEqual([{ type: "close-host", host: "a" }])
    expect(switched.state).toMatchObject({ active: "b", preferred: "b" })
    expect(transitionFindHostRegistry(switched.state, { type: "host.deactivated", host: "a" }).state).toBe(
      switched.state,
    )
  })

  test("unmounting the open host clears shared highlights and hands preference to a mounted one", () => {
    const unmounted = transitionFindHostRegistry(registered, { type: "host.unregistered", host: "a" })

    expect(unmounted.effects).toEqual([{ type: "clear-shared-highlights" }])
    expect(unmounted.state).toEqual({ hosts: new Set(["b"]), active: undefined, preferred: "b" })
  })

  test("shortcuts pick the open bar, then the focused host, then the preferred one", () => {
    const idle: FindHostRegistryState<string> = { ...registered, active: undefined }

    expect(selectShortcutHost(registered, "g", () => "b")).toBe("a")
    expect(selectShortcutHost(idle, "g", () => "b")).toBeUndefined()
    expect(selectShortcutHost(registered, "f", () => "b")).toBe("a")
    expect(selectShortcutHost(idle, "f", () => "b")).toBe("b")
    expect(selectShortcutHost(idle, "f", () => undefined)).toBe("a")
  })
})
