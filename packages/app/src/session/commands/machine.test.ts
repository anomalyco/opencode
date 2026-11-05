import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  createCloseTabGuardState,
  createSessionCommandsState,
  selectCloseTabSwallowed,
  transitionCloseTabGuard,
  transitionSessionCommands,
  type CloseTabGuardEvent,
  type CloseTabGuardState,
  type CloseTabGuardTransition,
  type SessionCommandsEvent,
  type SessionCommandsState,
  type SessionCommandsTransition,
} from "./machine"

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the machine passes export data through untouched */
const exported = { info: { id: "ses_1" } as SessionInfo, messages: [] }

function replay(events: SessionCommandsEvent[], from: SessionCommandsState = createSessionCommandsState()) {
  return events.reduce<SessionCommandsTransition[]>((steps, event) => {
    steps.push(transitionSessionCommands(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

function replayGuard(events: CloseTabGuardEvent[], from: CloseTabGuardState = createCloseTabGuardState()) {
  return events.reduce<CloseTabGuardTransition[]>((steps, event) => {
    steps.push(transitionCloseTabGuard(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

describe("transitionSessionCommands", () => {
  test("a repeated /compact while one admits runs once, so a failure is reported once", () => {
    const [first, repeat, other, failed] = replay([
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "compact.requested", sessionID: "ses_2" },
      { type: "compact.failed", attempt: 1, sessionID: "ses_1", cause: "409" },
    ])

    expect(first?.effects).toEqual([{ type: "compact.run", attempt: 1, sessionID: "ses_1" }])
    expect(repeat?.state).toBe(first!.state)
    expect(repeat?.effects).toEqual([])
    expect(other?.effects).toEqual([{ type: "compact.run", attempt: 2, sessionID: "ses_2" }])
    expect(failed?.effects).toEqual([{ type: "toast.request-failed", cause: "409" }])
    expect(failed?.state).toMatchObject({ compacting: { ses_2: 2 } })
  })

  test("a settled compaction can run again, and a stale result is dropped", () => {
    const [, succeeded, retried, late] = replay([
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "compact.succeeded", attempt: 1, sessionID: "ses_1" },
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "compact.failed", attempt: 1, sessionID: "ses_1", cause: "late" },
    ])

    expect(succeeded?.effects).toEqual([])
    expect(retried?.effects).toEqual([{ type: "compact.run", attempt: 2, sessionID: "ses_1" }])
    expect(late?.state).toBe(retried!.state)
    expect(late?.effects).toEqual([])
  })

  test("a repeated /export while one runs fetches and saves once", () => {
    const [first, repeat, fetched, saved] = replay([
      { type: "export.requested", sessionID: "ses_1" },
      { type: "export.requested", sessionID: "ses_1" },
      { type: "export.fetched", attempt: 1, sessionID: "ses_1", data: exported },
      { type: "export.saved", attempt: 1, sessionID: "ses_1", filename: "ses_1.json", saved: true },
    ])

    expect(first?.effects).toEqual([{ type: "export.fetch", attempt: 1, sessionID: "ses_1" }])
    expect(repeat?.state).toBe(first!.state)
    expect(repeat?.effects).toEqual([])
    // The save dialog may stay open a long time; the export still holds the session until it answers.
    expect(fetched?.state).toBe(first!.state)
    expect(fetched?.effects).toEqual([{ type: "export.save", attempt: 1, sessionID: "ses_1", data: exported }])
    expect(saved?.state).toMatchObject({ exporting: {} })
    expect(saved?.effects).toEqual([{ type: "toast.exported", filename: "ses_1.json" }])
  })

  test("a cancelled save is quiet and a failed fetch toasts", () => {
    const [, , cancelled] = replay([
      { type: "export.requested", sessionID: "ses_1" },
      { type: "export.fetched", attempt: 1, sessionID: "ses_1", data: exported },
      { type: "export.saved", attempt: 1, sessionID: "ses_1", filename: "ses_1.json", saved: false },
    ])

    const [, failed] = replay([
      { type: "export.requested", sessionID: "ses_1" },
      { type: "export.failed", attempt: 1, sessionID: "ses_1", message: "timed out" },
    ])

    expect(cancelled?.effects).toEqual([])
    expect(failed?.effects).toEqual([{ type: "toast.export-failed", message: "timed out" }])
  })

  test("leaving the session screen aborts exports and silences late results", () => {
    const [, , disposed, lateExport, lateCompact] = replay([
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "export.requested", sessionID: "ses_2" },
      { type: "disposed" },
      { type: "export.failed", attempt: 2, sessionID: "ses_2", message: "aborted" },
      { type: "compact.failed", attempt: 1, sessionID: "ses_1", cause: "late" },
    ])

    expect(disposed?.state).toEqual({ status: "disposed" })
    expect(disposed?.effects).toEqual([{ type: "export.abort", attempt: 2 }])
    expect(lateExport?.state).toBe(disposed!.state)
    expect(lateExport?.effects).toEqual([])
    expect(lateCompact?.effects).toEqual([])
  })

  test("a repeated /fork while the picker loads opens it once", () => {
    const [first, repeat, loaded, again] = replay([
      { type: "fork.requested", sessionID: "ses_1" },
      { type: "fork.requested", sessionID: "ses_1" },
      { type: "fork.loaded", attempt: 1 },
      { type: "fork.loaded", attempt: 1 },
    ])

    expect(first?.effects).toEqual([{ type: "fork.load", attempt: 1 }])
    expect(repeat?.state).toBe(first!.state)
    expect(loaded?.effects).toEqual([{ type: "fork.show" }])
    expect(again?.state).toBe(loaded!.state)
    expect(again?.effects).toEqual([])
  })

  test("the picker does not open over another session, and a failed load toasts", () => {
    const [, moved, late] = replay([
      { type: "fork.requested", sessionID: "ses_1" },
      { type: "session.changed", sessionID: "ses_2" },
      { type: "fork.loaded", attempt: 1 },
    ])

    const [, failed] = replay([
      { type: "fork.requested", sessionID: "ses_1" },
      { type: "fork.load-failed", attempt: 1, cause: "chunk" },
    ])

    expect(moved?.state).toMatchObject({ forkDialog: { status: "closed" } })
    expect(late?.effects).toEqual([])
    expect(failed?.effects).toEqual([{ type: "toast.request-failed", cause: "chunk" }])
    expect(failed?.state).toMatchObject({ forkDialog: { status: "closed" } })
  })

  test("switching session keeps the other session's compaction and export running", () => {
    const [, , changed] = replay([
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "export.requested", sessionID: "ses_1" },
      { type: "session.changed", sessionID: "ses_2" },
    ])

    expect(changed?.effects).toEqual([])
    expect(changed?.state).toMatchObject({ compacting: { ses_1: 1 }, exporting: { ses_1: 2 } })
  })
})

const closedPanel: CloseTabGuardEvent = { type: "close.completed", keybind: true, tabKey: "alpha", sideOpened: false }

describe("transitionCloseTabGuard", () => {
  test("focus the panel's close moves a moment later does not let the next ⌘W close the session tab", () => {
    const [armed, focused, settled, moved] = replayGuard([
      closedPanel,
      { type: "focus.in" },
      { type: "settle.completed", attempt: 1 },
      { type: "focus.in" },
    ])

    expect(armed?.state).toEqual({ status: "armed", attempt: 1, tabKey: "alpha", settling: true })
    expect(armed?.effects).toEqual([{ type: "settle.schedule", attempt: 1 }])
    expect(focused?.state).toBe(armed!.state)
    expect(selectCloseTabSwallowed(focused!.state)).toBe(true)
    expect(settled?.state).toEqual({ status: "armed", attempt: 1, tabKey: "alpha", settling: false })
    expect(moved?.state).toEqual({ status: "disarmed", issued: 1 })
    expect(selectCloseTabSwallowed(moved!.state)).toBe(false)
  })

  test("the panel closing, reported after the guard armed, does not disarm it", () => {
    const [armed, synced, otherTab] = replayGuard([
      closedPanel,
      { type: "layout.synced", tabKey: "alpha", sideOpened: false },
      { type: "layout.synced", tabKey: "beta", sideOpened: false },
    ])

    expect(synced?.state).toBe(armed!.state)
    expect(otherTab?.state).toEqual({ status: "disarmed", issued: 1 })
    expect(otherTab?.effects).toEqual([{ type: "settle.cancel" }])
  })

  test("the panel reopening disarms the guard", () => {
    const [, reopened] = replayGuard([closedPanel, { type: "layout.synced", tabKey: "alpha", sideOpened: true }])

    expect(reopened?.state).toEqual({ status: "disarmed", issued: 1 })
  })

  test.each<[string, CloseTabGuardEvent]>([
    ["a click", { type: "pointer.down" }],
    ["leaving the window", { type: "window.blur" }],
    ["another key", { type: "key.down", key: "a", matchesClose: false }],
  ])("%s disarms the guard", (_name, event) => {
    const [, settling] = replayGuard([closedPanel, event])
    const [, , settled] = replayGuard([closedPanel, { type: "settle.completed", attempt: 1 }, event])

    expect(settling?.state).toEqual({ status: "disarmed", issued: 1 })
    expect(settling?.effects).toEqual([{ type: "settle.cancel" }])
    expect(settled?.state).toEqual({ status: "disarmed", issued: 1 })
    expect(settled?.effects).toEqual([])
  })

  test("modifier keys and repeated ⌘W keep swallowing", () => {
    const [armed, modifier, close] = replayGuard([
      closedPanel,
      { type: "key.down", key: "Meta", matchesClose: false },
      { type: "key.down", key: "w", matchesClose: true },
    ])

    expect(modifier?.state).toBe(armed!.state)
    expect(close?.state).toBe(armed!.state)
  })

  test("a close from the palette, or one that leaves the panel open, does not arm", () => {
    const disarmed = createCloseTabGuardState()

    expect(transitionCloseTabGuard(disarmed, { ...closedPanel, keybind: false }).state).toBe(disarmed)
    expect(transitionCloseTabGuard(disarmed, { ...closedPanel, sideOpened: true }).state).toBe(disarmed)
  })

  test("re-arming fences the previous frame, and a stale settle is dropped", () => {
    const [, rearmed, stale] = replayGuard([closedPanel, closedPanel, { type: "settle.completed", attempt: 1 }])

    expect(rearmed?.effects).toEqual([{ type: "settle.cancel" }, { type: "settle.schedule", attempt: 2 }])
    expect(stale?.state).toBe(rearmed!.state)
  })

  test("a disarmed guard keeps its state for every input", () => {
    const disarmed = createCloseTabGuardState()

    const events: CloseTabGuardEvent[] = [
      { type: "pointer.down" },
      { type: "focus.in" },
      { type: "window.blur" },
      { type: "key.down", key: "a", matchesClose: false },
      { type: "layout.synced", tabKey: "beta", sideOpened: true },
      { type: "settle.completed", attempt: 1 },
    ]

    events.forEach((event) => expect(transitionCloseTabGuard(disarmed, event).state).toBe(disarmed))
  })

  test("disposing cancels a pending frame and ignores everything after", () => {
    const [, disposed, late] = replayGuard([closedPanel, { type: "disposed" }, closedPanel])

    expect(disposed?.effects).toEqual([{ type: "settle.cancel" }])
    expect(late?.state).toBe(disposed!.state)
    expect(late?.effects).toEqual([])
  })
})
