import { describe, expect, test } from "bun:test"
import { cursorPlan, filterModeSequences, isLikelyTui, restoreSize } from "./terminal-tui"

describe("terminal TUI helpers", () => {
  test("isLikelyTui: matches title", () => {
    expect(
      isLikelyTui({ snapshotWasAltScreen: false, title: "Codex 5", initialCommand: "" }),
    ).toBe(true)
  })

  test("isLikelyTui: matches initial command", () => {
    expect(
      isLikelyTui({ snapshotWasAltScreen: false, title: "", initialCommand: "opencode" }),
    ).toBe(true)
  })

  test("isLikelyTui: snapshot alt screen implies TUI", () => {
    expect(
      isLikelyTui({ snapshotWasAltScreen: true, title: "", initialCommand: "" }),
    ).toBe(true)
  })

  test("filterModeSequences: strips alt-screen toggles always", () => {
    const raw = "\x1b[?1049h\x1b[?1h\x1b[?1049l"
    expect(filterModeSequences({ raw, likelyTui: true })).toBe("\x1b[?1h")
    expect(filterModeSequences({ raw, likelyTui: false })).toBe("\x1b[?1h")
  })

  test("filterModeSequences: non-TUI strips mouse/focus", () => {
    const raw = "\x1b[?1h\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[?2004h"
    expect(filterModeSequences({ raw, likelyTui: false })).toBe("\x1b[?1h\x1b[?2004h")
  })

  test("filterModeSequences: TUI keeps mouse/focus", () => {
    const raw = "\x1b[?1h\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[?2004h"
    expect(filterModeSequences({ raw, likelyTui: true })).toBe(raw)
  })

  test("cursorPlan: TUI split with snapshot uses live tail", () => {
    const plan = cursorPlan({
      likelyTui: true,
      splitWidthChanged: true,
      isReload: false,
      snapshotHasBuffer: true,
      snapshotWasAltScreen: false,
      snapshotCursor: 1234,
    })
    expect(plan.useLiveTailCursor).toBe(true)
    expect(plan.cursorParam).toBe(-1)
  })

  test("cursorPlan: reload + alt snapshot uses live tail", () => {
    const plan = cursorPlan({
      likelyTui: true,
      splitWidthChanged: false,
      isReload: true,
      snapshotHasBuffer: true,
      snapshotWasAltScreen: true,
      snapshotCursor: 5000,
    })
    expect(plan.useLiveTailCursor).toBe(true)
    expect(plan.cursorParam).toBe(-1)
  })

  test("cursorPlan: non-TUI with persisted buffer uses live tail", () => {
    const plan = cursorPlan({
      likelyTui: false,
      splitWidthChanged: false,
      isReload: false,
      snapshotHasBuffer: true,
      snapshotWasAltScreen: false,
      snapshotCursor: 9000,
    })
    expect(plan.useLiveTailCursor).toBe(true)
    expect(plan.cursorParam).toBe(-1)
  })

  test("restoreSize: prefers mountCols for TUI split", () => {
    const size = restoreSize({
      likelyTui: true,
      splitWidthChanged: true,
      mountCols: 57,
      snapshotCols: 117,
      snapshotRows: 44,
      backendCols: 57,
      backendRows: 44,
    })
    expect(size.cols).toBe(57)
    expect(size.rows).toBe(44)
  })
})

