import { describe, expect, test } from "bun:test"
import {
  CLOSE_TAB_GUARD_QUIET_MS,
  SESSION_DIALOG_LOAD_TIMEOUT_MS,
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
  type SessionDialogKind,
} from "./machine"

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

  test("leaving the session screen silences late results", () => {
    const [, disposed, lateCompact] = replay([
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "disposed" },
      { type: "compact.failed", attempt: 1, sessionID: "ses_1", cause: "late" },
    ])

    expect(disposed?.state).toEqual({ status: "disposed" })
    expect(lateCompact?.state).toBe(disposed!.state)
    expect(lateCompact?.effects).toEqual([])
  })

  test.each<SessionDialogKind>(["fork", "palette", "mcp"])(
    "a repeated request while the %s dialog loads opens it once",
    (kind) => {
      const [first, repeat, loaded, again] = replay([
        { type: "dialog.requested", kind, sessionKey: "A" },
        { type: "dialog.requested", kind, sessionKey: "A" },
        { type: "dialog.loaded", attempt: 1 },
        { type: "dialog.loaded", attempt: 1 },
      ])

      expect(first?.effects).toEqual([
        { type: "dialog.load", attempt: 1, kind, timeoutMs: SESSION_DIALOG_LOAD_TIMEOUT_MS },
      ])
      expect(repeat?.state).toBe(first!.state)
      expect(repeat?.effects).toEqual([])
      expect(loaded?.effects).toEqual([{ type: "dialog.cancel" }, { type: "dialog.show", kind }])
      expect(again?.state).toBe(loaded!.state)
      expect(again?.effects).toEqual([])
    },
  )

  // Before, /open and /mcp awaited the chunk with nothing to catch a failure: an unhandled rejection, and no toast.
  test("a failed /open load toasts and the next request loads again", () => {
    const [, failed, retried] = replay([
      { type: "dialog.requested", kind: "palette", sessionKey: "A" },
      { type: "dialog.load-failed", attempt: 1, cause: "ChunkLoadError" },
      { type: "dialog.requested", kind: "palette", sessionKey: "A" },
    ])

    expect(failed?.effects).toEqual([
      { type: "dialog.cancel" },
      { type: "toast.request-failed", cause: "ChunkLoadError" },
    ])
    expect(failed?.state).toMatchObject({ dialog: { status: "closed" } })
    expect(retried?.effects).toEqual([
      { type: "dialog.load", attempt: 2, kind: "palette", timeoutMs: SESSION_DIALOG_LOAD_TIMEOUT_MS },
    ])
  })

  // Before, a chunk that never arrived left the command doing nothing, for good.
  test("a stalled /mcp load times out with a toast, and its late result opens nothing", () => {
    const [, timedOut, late] = replay([
      { type: "dialog.requested", kind: "mcp", sessionKey: "A" },
      { type: "dialog.timed-out", attempt: 1 },
      { type: "dialog.loaded", attempt: 1 },
    ])

    expect(timedOut?.effects).toEqual([{ type: "toast.request-failed", cause: undefined }])
    expect(late?.state).toBe(timedOut!.state)
    expect(late?.effects).toEqual([])
  })

  test("another dialog replaces one still loading", () => {
    const [, replaced, stale, loaded] = replay([
      { type: "dialog.requested", kind: "palette", sessionKey: "A" },
      { type: "dialog.requested", kind: "mcp", sessionKey: "A" },
      { type: "dialog.loaded", attempt: 1 },
      { type: "dialog.loaded", attempt: 2 },
    ])

    expect(replaced?.effects).toEqual([
      { type: "dialog.cancel" },
      { type: "dialog.load", attempt: 2, kind: "mcp", timeoutMs: SESSION_DIALOG_LOAD_TIMEOUT_MS },
    ])
    expect(stale?.state).toBe(replaced!.state)
    expect(loaded?.effects).toEqual([{ type: "dialog.cancel" }, { type: "dialog.show", kind: "mcp" }])
  })

  // Moved from the retired session ownership helper: leaving the session, even to come back, drops the load.
  test("a dialog does not open over another session, or after returning to its own", () => {
    const [, moved, back, late] = replay([
      { type: "dialog.requested", kind: "fork", sessionKey: "A" },
      { type: "session.changed", sessionKey: "B" },
      { type: "session.changed", sessionKey: "A" },
      { type: "dialog.loaded", attempt: 1 },
    ])

    expect(moved?.state).toMatchObject({ dialog: { status: "closed" } })
    expect(moved?.effects).toEqual([{ type: "dialog.cancel" }])
    expect(back?.state).toBe(moved!.state)
    expect(late?.effects).toEqual([])
  })

  test("leaving the session screen cancels a loading dialog and ignores requests after", () => {
    const [, disposed, requested, loaded] = replay([
      { type: "dialog.requested", kind: "palette", sessionKey: "A" },
      { type: "disposed" },
      { type: "dialog.requested", kind: "palette", sessionKey: "A" },
      { type: "dialog.loaded", attempt: 1 },
    ])

    expect(disposed?.effects).toEqual([{ type: "dialog.cancel" }])
    expect(requested?.state).toBe(disposed!.state)
    expect(requested?.effects).toEqual([])
    expect(loaded?.effects).toEqual([])
  })

  test("switching session keeps the other session's compaction running", () => {
    const [, changed] = replay([
      { type: "compact.requested", sessionID: "ses_1" },
      { type: "session.changed", sessionKey: "B" },
    ])

    expect(changed?.effects).toEqual([])
    expect(changed?.state).toMatchObject({ compacting: { ses_1: 1 } })
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
    expect(armed?.effects).toEqual([{ type: "settle.schedule", attempt: 1 }, { type: "quiet.schedule", attempt: 1, timeoutMs: CLOSE_TAB_GUARD_QUIET_MS }])
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
    expect(otherTab?.effects).toEqual([{ type: "settle.cancel" }, { type: "quiet.cancel" }])
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
    expect(settling?.effects).toEqual([{ type: "settle.cancel" }, { type: "quiet.cancel" }])
    expect(settled?.state).toEqual({ status: "disarmed", issued: 1 })
    expect(settled?.effects).toEqual([{ type: "quiet.cancel" }])
  })

  test("modifier keys and repeated ⌘W keep swallowing, each ⌘W restarting the rest", () => {
    const [armed, modifier, close] = replayGuard([
      closedPanel,
      { type: "key.down", key: "Meta", matchesClose: false },
      { type: "key.down", key: "w", matchesClose: true },
    ])

    expect(modifier?.state).toBe(armed!.state)
    expect(modifier?.effects).toEqual([])
    expect(close?.state).toBe(armed!.state)
    expect(close?.effects).toEqual([{ type: "quiet.schedule", attempt: 1, timeoutMs: CLOSE_TAB_GUARD_QUIET_MS }])
  })

  test("once ⌘W rests, the next ⌘W closes the session tab again", () => {
    const [, , stale, rested] = replayGuard([
      closedPanel,
      { type: "key.down", key: "w", matchesClose: true },
      { type: "quiet.elapsed", attempt: 0 },
      { type: "quiet.elapsed", attempt: 1 },
    ])

    expect(selectCloseTabSwallowed(stale!.state)).toBe(true)
    expect(rested?.state).toEqual({ status: "disarmed", issued: 1 })
    expect(selectCloseTabSwallowed(rested!.state)).toBe(false)
  })

  test("a close from the palette, or one that leaves the panel open, does not arm", () => {
    const disarmed = createCloseTabGuardState()

    expect(transitionCloseTabGuard(disarmed, { ...closedPanel, keybind: false }).state).toBe(disarmed)
    expect(transitionCloseTabGuard(disarmed, { ...closedPanel, sideOpened: true }).state).toBe(disarmed)
  })

  test("re-arming fences the previous frame, and a stale settle is dropped", () => {
    const [, rearmed, stale] = replayGuard([closedPanel, closedPanel, { type: "settle.completed", attempt: 1 }])

    expect(rearmed?.effects).toEqual([
      { type: "settle.cancel" },
      { type: "settle.schedule", attempt: 2 },
      { type: "quiet.schedule", attempt: 2, timeoutMs: CLOSE_TAB_GUARD_QUIET_MS },
    ])
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
      { type: "quiet.elapsed", attempt: 1 },
    ]

    events.forEach((event) => expect(transitionCloseTabGuard(disarmed, event).state).toBe(disarmed))
  })

  test("disposing cancels a pending frame and ignores everything after", () => {
    const [, disposed, late] = replayGuard([closedPanel, { type: "disposed" }, closedPanel])

    expect(disposed?.effects).toEqual([{ type: "settle.cancel" }, { type: "quiet.cancel" }])
    expect(late?.state).toBe(disposed!.state)
    expect(late?.effects).toEqual([])
  })
})
