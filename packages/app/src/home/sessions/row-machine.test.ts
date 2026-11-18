import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import {
  HOME_SESSION_RENAME_TIMEOUT_MS,
  INITIAL_HOME_SESSION_ROW_STATE,
  selectLongPressMoved,
  selectRowEditor,
  selectRowMenu,
  selectRowSuppressClick,
  transitionHomeSessionRow,
  type HomeSessionRowEffect,
  type HomeSessionRowEvent,
  type HomeSessionRowState,
} from "./row-machine"

// SAFETY: the brand only marks registry-built keys; the machine passes it through.
const SERVER = "http:a" as ServerConnection.Key

// SAFETY: the machine passes the session through to the save effect.
const SESSION = { id: "ses_a" } as SessionInfo

const press = (sessionID = "ses_a"): HomeSessionRowEvent => ({
  type: "touch.down",
  sessionID,
  x: 100,
  y: 20,
  menuX: 40,
  menuY: 12,
})

const submit: HomeSessionRowEvent = {
  type: "editor.submit",
  sessionID: "ses_a",
  server: SERVER,
  session: SESSION,
  title: "Old",
}

const rename: HomeSessionRowEvent[] = [
  { type: "rename.start", sessionID: "ses_a", title: "Old" },
  { type: "editor.input", sessionID: "ses_a", draft: "New" },
  submit,
]

function replay(events: HomeSessionRowEvent[], state = INITIAL_HOME_SESSION_ROW_STATE) {
  return events.reduce<{ state: HomeSessionRowState; effects: readonly HomeSessionRowEffect[] }>(
    (step, event) => transitionHomeSessionRow(step.state, event),
    { state, effects: [] },
  )
}

describe("home session row machine", () => {
  test("Escape cancels a save that hangs, and its late answer changes nothing", () => {
    const renaming = replay(rename)
    expect(renaming.state).toMatchObject({ status: "renaming", attempt: 1, draft: "New" })
    expect(renaming.effects).toEqual([
      {
        type: "rename.save",
        attempt: 1,
        server: SERVER,
        session: SESSION,
        title: "New",
        timeoutMs: HOME_SESSION_RENAME_TIMEOUT_MS,
      },
    ])
    expect(selectRowEditor(renaming.state, "ses_a")?.status).toBe("renaming")

    const cancelled = replay([{ type: "editor.cancel", sessionID: "ses_a", reason: "escape" }], renaming.state)
    expect(cancelled.state).toMatchObject({ status: "idle" })
    expect(cancelled.effects).toEqual([
      { type: "rename.abort", attempt: 1 },
      { type: "focus.row", sessionID: "ses_a", ifOwned: false },
    ])

    for (const type of ["rename.succeeded", "rename.failed", "rename.timed-out"] as const) {
      expect(transitionHomeSessionRow(cancelled.state, { type, attempt: 1 }).state).toBe(cancelled.state)
    }
  })

  test("a failed or timed-out save returns to editing with the draft; clicking away lets it finish", () => {
    const renaming = replay(rename)
    expect(
      transitionHomeSessionRow(renaming.state, { type: "editor.cancel", sessionID: "ses_a", reason: "blur" }).state,
    ).toBe(renaming.state)

    const timedOut = replay([{ type: "rename.timed-out", attempt: 1 }], renaming.state)
    expect(timedOut.state).toMatchObject({ status: "editing", draft: "New" })
    expect(timedOut.effects).toEqual([
      { type: "rename.abort", attempt: 1 },
      { type: "toast.rename-timeout" },
      { type: "focus.editor", sessionID: "ses_a", select: false, ifOwned: true },
    ])

    expect(replay([{ type: "rename.failed", attempt: 1 }], renaming.state).state).toMatchObject({
      status: "editing",
      draft: "New",
    })

    const saved = replay([{ type: "rename.succeeded", attempt: 1 }], renaming.state)
    expect(saved.state).toMatchObject({ status: "idle" })
    expect(saved.effects).toEqual([{ type: "focus.row", sessionID: "ses_a", ifOwned: true }])

    // An unchanged title saves nothing.
    const unchanged = replay([{ type: "rename.start", sessionID: "ses_a", title: "Old" }, submit])
    expect(unchanged.state.status).toBe("idle")
    expect(unchanged.effects).toEqual([{ type: "focus.row", sessionID: "ses_a", ifOwned: false }])
  })

  test("a long press opens the menu and swallows its release click once, whichever row instance gets it", () => {
    const pressing = replay([press()])
    expect(pressing.effects).toEqual([{ type: "long-press.start", attempt: 1, delayMs: 500 }])

    // Moves inside the slop are filtered before any event is built.
    expect(selectLongPressMoved(pressing.state, 106, 26)).toBe(false)
    expect(transitionHomeSessionRow(pressing.state, { type: "touch.move", x: 106, y: 26 }).state).toBe(pressing.state)
    const scrolled = replay([{ type: "touch.move", x: 100, y: 40 }], pressing.state)
    expect(scrolled.state.status).toBe("idle")
    expect(scrolled.effects).toEqual([{ type: "long-press.stop" }])

    const opened = replay([{ type: "long-press.fired", attempt: 1 }], pressing.state)
    expect(selectRowMenu(opened.state, "ses_a")).toMatchObject({ x: 40, y: 12 })
    expect(selectRowSuppressClick(opened.state, "ses_a", 1)).toBe(true)
    expect(selectRowSuppressClick(opened.state, "ses_a", 0)).toBe(false)

    const clicked = replay([{ type: "row.clicked", sessionID: "ses_a" }], opened.state)
    expect(selectRowSuppressClick(clicked.state, "ses_a", 1)).toBe(false)
    expect(selectRowMenu(clicked.state, "ses_a")).toBeDefined()

    // The menu can close before the release click arrives.
    const closed = replay([{ type: "menu.closed", sessionID: "ses_a" }], opened.state)
    expect(selectRowSuppressClick(closed.state, "ses_a", 1)).toBe(true)
    const consumed = replay([{ type: "row.clicked", sessionID: "ses_a" }], closed.state)
    expect(selectRowSuppressClick(consumed.state, "ses_a", 1)).toBe(false)
    expect(selectRowSuppressClick(replay([{ type: "pointer.down" }], closed.state).state, "ses_a", 1)).toBe(false)

    // A stale long-press timer changes nothing.
    expect(transitionHomeSessionRow(clicked.state, { type: "long-press.fired", attempt: 1 }).state).toBe(clicked.state)
  })

  test("Android's contextmenu during a long press still swallows the release click", () => {
    const opened = replay([press(), { type: "menu.open", sessionID: "ses_a", x: 40, y: 12 }])

    expect(opened.effects).toEqual([{ type: "long-press.stop" }])
    expect(selectRowSuppressClick(opened.state, "ses_a", 1)).toBe(true)
    expect(transitionHomeSessionRow(opened.state, { type: "long-press.fired", attempt: 1 }).state).toBe(opened.state)
  })

  test("closing the menu restores focus to the row unless the user clicked elsewhere or chose Rename", () => {
    const open = replay([{ type: "menu.open", sessionID: "ses_a", x: 12, y: 40 }])
    expect(selectRowSuppressClick(open.state, "ses_a", 1)).toBe(false)
    expect(replay([{ type: "menu.closed", sessionID: "ses_a" }], open.state).effects).toEqual([
      { type: "focus.row", sessionID: "ses_a", ifOwned: false },
    ])

    const outside = replay(
      [
        { type: "menu.interact-outside", sessionID: "ses_a" },
        { type: "menu.closed", sessionID: "ses_a" },
      ],
      open.state,
    )

    expect(outside.state.status).toBe("idle")
    expect(outside.effects).toEqual([])

    const renaming = replay(
      [
        { type: "rename.start", sessionID: "ses_a", title: "Old" },
        { type: "menu.closed", sessionID: "ses_a" },
      ],
      open.state,
    )

    expect(selectRowEditor(renaming.state, "ses_a")).toMatchObject({ status: "editing", draft: "Old" })
    expect(renaming.effects).toEqual([])

    // The editor keeps the native menu.
    expect(transitionHomeSessionRow(renaming.state, { type: "menu.open", sessionID: "ses_a", x: 0, y: 0 }).state).toBe(
      renaming.state,
    )
  })

  test("a row that leaves the list ends its gesture; one that moves to another group keeps it", () => {
    const pressing = replay([press()])
    expect(
      transitionHomeSessionRow(pressing.state, { type: "sessions.synced", sessionIDs: new Set(["ses_a"]) }).state,
    ).toBe(pressing.state)

    const gone = replay([{ type: "sessions.synced", sessionIDs: new Set(["ses_b"]) }], pressing.state)
    expect(gone.state.status).toBe("idle")
    expect(gone.effects).toEqual([{ type: "long-press.stop" }])
  })

  test("disposing stops the long press and ignores what arrives later", () => {
    const disposed = replay([press(), { type: "disposed" }])

    expect(disposed.effects).toEqual([{ type: "long-press.stop" }])
    expect(transitionHomeSessionRow(disposed.state, { type: "long-press.fired", attempt: 1 }).state).toBe(
      disposed.state,
    )
  })
})
