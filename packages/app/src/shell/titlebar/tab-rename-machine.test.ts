import { describe, expect, test } from "bun:test"
import {
  INITIAL_TAB_RENAME_STATE,
  isTabRenaming,
  selectTabPreviewBlocked,
  transitionTabRename,
  type TabRenameEffect,
  type TabRenameEvent,
  type TabRenameState,
} from "./tab-rename-machine"

const sessionID = "ses_tab"

function replay(events: TabRenameEvent[], state: TabRenameState = INITIAL_TAB_RENAME_STATE) {
  return events.reduce<{ state: TabRenameState; effects: TabRenameEffect[] }>(
    (acc, event) => {
      const next = transitionTabRename(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// Double-click, type, Enter: what the tab does for one rename while the session shows `current`.
function rename(title: string, current: string): TabRenameEvent[] {
  return [
    { type: "edit.start", source: "pointer", sessionID, title: current, enabled: true },
    { type: "edit.input", value: title },
    { type: "edit.submit", currentTitle: current },
  ]
}

const remembered = (effects: TabRenameEffect[]) =>
  effects.flatMap((effect) => (effect.type === "session.remember" ? [effect.title] : []))

describe("tab rename machine", () => {
  test("restores the server's title, not an unsaved one, when overlapping renames both fail", () => {
    const saving = replay([...rename("A", "Original"), ...rename("B", "A")])
    expect(saving.effects.filter((effect) => effect.type === "save.start")).toMatchObject([
      { attempt: 1, title: "A" },
      { attempt: 2, title: "B" },
    ])

    const first = replay(
      [{ type: "save.failed", attempt: 1, currentTitle: "B", error: new Error("first") }],
      saving.state,
    )

    expect(first.effects).toEqual([])

    const second = replay(
      [{ type: "save.failed", attempt: 2, currentTitle: "B", error: new Error("second") }],
      first.state,
    )

    expect(remembered(second.effects)).toEqual(["Original"])
    expect(second.effects.at(-1)).toMatchObject({ type: "toast.failed" })
    expect(second.state).toMatchObject({ status: "idle", save: { status: "idle", settledAttempt: 2 } })
  })

  test("restores an older save that landed when the newest one fails", () => {
    const result = replay([
      ...rename("A", "Original"),
      ...rename("B", "A"),
      { type: "save.succeeded", attempt: 1, title: "A" },
      { type: "save.failed", attempt: 2, currentTitle: "B", error: new Error("offline") },
    ])

    expect(remembered(result.effects)).toEqual(["A", "B", "A"])
  })

  test("an older failure never rolls back a newer rename to the same text", () => {
    const result = replay([
      ...rename("A", "Original"),
      ...rename("B", "A"),
      ...rename("A", "B"),
      { type: "save.failed", attempt: 1, currentTitle: "A", error: new Error("first") },
    ])

    expect(remembered(result.effects)).toEqual(["A", "B", "A"])
    expect(result.state).toMatchObject({ save: { status: "saving", attempt: 3, confirmed: "Original" } })
    expect(replay([{ type: "save.succeeded", attempt: 3, title: "A" }], result.state).state).toMatchObject({
      save: { status: "idle", settledAttempt: 3 },
    })
  })

  test("a failed save keeps a title the server pushed meanwhile", () => {
    const result = replay([
      ...rename("A", "Original"),
      { type: "save.failed", attempt: 1, currentTitle: "Server rename", error: new Error("offline") },
    ])

    expect(remembered(result.effects)).toEqual(["A"])
    expect(result.effects.at(-1)).toMatchObject({ type: "toast.failed" })
  })

  test("a menu that closes without Rename leaves nothing to start later", () => {
    const result = replay([
      { type: "menu.changed", open: true },
      { type: "menu.changed", open: false },
      { type: "menu.changed", open: true },
      { type: "menu.changed", open: false },
    ])

    expect(result.state).toMatchObject({ status: "idle", menuOpen: false })
    expect(result.effects).toEqual([])
  })

  test("Rename in the menu starts the edit at once and closes the menu", () => {
    const open = replay([{ type: "menu.changed", open: true }])
    expect(selectTabPreviewBlocked(open.state)).toBe(true)

    const result = replay(
      [{ type: "edit.start", source: "menu", sessionID, title: "Original", enabled: true }],
      open.state,
    )

    expect(result.state).toMatchObject({ status: "arming", source: "menu", attempt: 1, menuOpen: false })
    expect(result.effects).toEqual([{ type: "editor.arm", attempt: 1, source: "menu", text: "Original" }])
  })

  test("a blur while focus settles keeps editing, and a blur once armed saves", () => {
    const start: TabRenameEvent = { type: "edit.start", source: "pointer", sessionID, title: "Original", enabled: true }
    const arming = replay([start, { type: "edit.blur", currentTitle: "Original" }])
    expect(isTabRenaming(arming.state)).toBe(true)

    const stale = replay([{ type: "edit.armed", attempt: 2 }], arming.state)
    expect(stale.state).toBe(arming.state)

    const saved = replay(
      [
        { type: "edit.armed", attempt: 1 },
        { type: "edit.input", value: "Renamed" },
        { type: "edit.blur", currentTitle: "Original" },
      ],
      arming.state,
    )

    expect(saved.state.status).toBe("idle")
    expect(saved.effects).toEqual([
      { type: "editor.reset" },
      { type: "session.remember", sessionID, title: "Renamed" },
      { type: "save.start", attempt: 1, sessionID, title: "Renamed", timeoutMs: 15_000 },
    ])
  })

  test("typing before the title arms keeps the typed text unselected", () => {
    const result = replay([
      { type: "edit.start", source: "pointer", sessionID, title: "Original", enabled: true },
      { type: "edit.input", value: "Typed" },
    ])

    expect(result.state).toMatchObject({ status: "arming", draft: "Typed", edited: true })
  })

  test("Escape, an unchanged or empty title, and a dragged tab save nothing", () => {
    const start: TabRenameEvent = { type: "edit.start", source: "pointer", sessionID, title: "Original", enabled: true }

    expect(replay([start, { type: "edit.cancel" }]).effects).toEqual([
      { type: "editor.arm", attempt: 1, source: "pointer", text: "Original" },
      { type: "editor.disarm" },
      { type: "editor.reset" },
    ])
    expect(
      replay([start, { type: "edit.input", value: " Original " }, { type: "edit.submit", currentTitle: "Original" }])
        .state,
    ).toMatchObject({ status: "idle", saveIssued: 0 })
    expect(
      replay([start, { type: "edit.input", value: "  " }, { type: "edit.submit", currentTitle: "Original" }]).state,
    ).toMatchObject({ status: "idle", saveIssued: 0 })
    expect(replay([{ ...start, enabled: false }]).state).toBe(INITIAL_TAB_RENAME_STATE)
    expect(replay([{ ...start, sessionID: undefined }]).state).toBe(INITIAL_TAB_RENAME_STATE)
  })

  test("a save that hangs times out, aborts, rolls back and reports", () => {
    const result = replay([...rename("A", "Original"), { type: "save.timed-out", attempt: 1, currentTitle: "A" }])

    expect(result.effects.slice(-3)).toEqual([
      { type: "save.abort", attempt: 1 },
      { type: "session.remember", sessionID, title: "Original" },
      { type: "toast.failed", error: undefined },
    ])
    expect(replay([{ type: "save.succeeded", attempt: 1, title: "A" }], result.state).state).toBe(result.state)
  })

  test("another session drops the edit and the save; unmounting stops timers but lets the save finish", () => {
    const editing = replay([
      ...rename("A", "Original"),
      { type: "edit.start", source: "pointer", sessionID, title: "A", enabled: true },
    ])

    const moved = replay([{ type: "session.changed", sessionID: "ses_other" }], editing.state)
    expect(moved.state).toMatchObject({ status: "idle", save: { status: "idle" } })
    expect(moved.effects).toEqual([{ type: "editor.disarm" }, { type: "editor.reset" }, { type: "save.clear-timers" }])
    expect(replay([{ type: "session.changed", sessionID }], editing.state).state).toBe(editing.state)

    const disposed = replay([{ type: "disposed" }], editing.state)
    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects).toEqual([{ type: "editor.disarm" }, { type: "save.clear-timers" }])
    expect(
      replay([{ type: "save.failed", attempt: 1, currentTitle: "A", error: new Error("late") }], disposed.state)
        .effects,
    ).toEqual([])
  })
})
