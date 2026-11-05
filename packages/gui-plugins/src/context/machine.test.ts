import { describe, expect, test } from "bun:test"
import type { SessionExportData } from "./export"
import {
  createContextScrollState,
  createSessionExportState,
  selectSessionExporting,
  transitionContextScroll,
  transitionSessionExport,
  type ContextScrollEvent,
  type ContextScrollState,
  type SessionExportEvent,
  type SessionExportState,
} from "./machine"

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the export only passes this record through */
const data = { info: { id: "ses_1" }, messages: [] } as unknown as SessionExportData

function exportAfter(...events: SessionExportEvent[]) {
  return events.reduce<SessionExportState>(
    (state, event) => transitionSessionExport(state, event).state,
    createSessionExportState(),
  )
}

describe("transitionSessionExport", () => {
  test("a second click while the export loads or the save dialog is open does nothing", () => {
    const requested: SessionExportEvent = { type: "export.requested", sessionKey: "a", sessionID: "ses_1" }
    const loading = exportAfter(requested)

    expect(transitionSessionExport(loading, requested)).toEqual({ state: loading, effects: [] })
    expect(transitionSessionExport(loading, requested).state).toBe(loading)
    expect(selectSessionExporting(loading, "a")).toBe(true)

    const saving = transitionSessionExport(loading, { type: "export.fetched", attempt: 1, sessionKey: "a", data })

    expect(saving.state).toBe(loading)
    expect(saving.effects).toEqual([{ type: "export.save", attempt: 1, sessionKey: "a", data }])
    expect(transitionSessionExport(saving.state, requested).state).toBe(loading)
  })

  test("another session exports alongside, and each result settles only its own", () => {
    const state = exportAfter(
      { type: "export.requested", sessionKey: "a", sessionID: "ses_1" },
      { type: "export.requested", sessionKey: "b", sessionID: "ses_2" },
    )

    expect(state).toEqual({ status: "active", issued: 2, exporting: { a: 1, b: 2 } })

    const saved = transitionSessionExport(state, {
      type: "export.saved",
      attempt: 2,
      sessionKey: "b",
      filename: "b.json",
      saved: true,
    })

    expect(saved.effects).toEqual([{ type: "toast.exported", filename: "b.json" }])
    expect(selectSessionExporting(saved.state, "a")).toBe(true)
    expect(selectSessionExporting(saved.state, "b")).toBe(false)
  })

  test("a cancelled save dialog ends the export without a toast; a failure toasts its message", () => {
    const loading = exportAfter({ type: "export.requested", sessionKey: "a", sessionID: "ses_1" })
    const cancelled = transitionSessionExport(loading, {
      type: "export.saved",
      attempt: 1,
      sessionKey: "a",
      filename: "a.json",
      saved: false,
    })
    const failed = transitionSessionExport(loading, {
      type: "export.failed",
      attempt: 1,
      sessionKey: "a",
      message: "The operation timed out.",
    })

    expect(cancelled.effects).toEqual([])
    expect(selectSessionExporting(cancelled.state, "a")).toBe(false)
    expect(failed.effects).toEqual([{ type: "toast.export-failed", message: "The operation timed out." }])
    expect(selectSessionExporting(failed.state, "a")).toBe(false)
  })

  test("a result of an earlier export is ignored", () => {
    const state = exportAfter(
      { type: "export.requested", sessionKey: "a", sessionID: "ses_1" },
      { type: "export.failed", attempt: 1, sessionKey: "a" },
      { type: "export.requested", sessionKey: "a", sessionID: "ses_1" },
    )

    expect(transitionSessionExport(state, { type: "export.fetched", attempt: 1, sessionKey: "a", data })).toEqual({
      state,
      effects: [],
    })
  })

  test("closing the tab aborts every export and silences late results", () => {
    const state = exportAfter(
      { type: "export.requested", sessionKey: "a", sessionID: "ses_1" },
      { type: "export.requested", sessionKey: "b", sessionID: "ses_2" },
    )
    const disposed = transitionSessionExport(state, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "export.abort", attempt: 1 },
      { type: "export.abort", attempt: 2 },
    ])
    expect(
      transitionSessionExport(disposed.state, { type: "export.failed", attempt: 1, sessionKey: "a", message: "abort" }),
    ).toEqual({ state: disposed.state, effects: [] })
  })
})

const showA: ContextScrollEvent = { type: "target.synced", sessionKey: "a", active: true }

function scrollAfter(...events: ContextScrollEvent[]) {
  return events.reduce<ContextScrollState>(
    (state, event) => transitionContextScroll(state, event).state,
    createContextScrollState(),
  )
}

describe("transitionContextScroll", () => {
  test("restores a frame after the session shows", () => {
    expect(transitionContextScroll(createContextScrollState(), showA)).toEqual({
      state: { status: "restoring", sessionKey: "a", attempt: 1, frame: true, applied: undefined },
      effects: [{ type: "frame.schedule", kind: "restore", attempt: 1 }],
    })
  })

  test("a message that renders after the user scrolled does not jump back to the stored offset", () => {
    const state = scrollAfter(
      showA,
      { type: "restore.applied", attempt: 1, applied: undefined },
      { type: "interacted" },
      { type: "scrolled", position: { x: 0, y: 500 } },
    )
    const rendered = transitionContextScroll(state, { type: "content.changed" })

    expect(rendered).toEqual({ state, effects: [] })
    expect(state.status === "tracking" && state.attempt).toBe(3)
    expect(transitionContextScroll(state, { type: "save.flushed", attempt: 3 }).effects).toEqual([
      { type: "save.write", sessionKey: "a", position: { x: 0, y: 500 } },
    ])
  })

  test("switching session stores the last offset for the session left, then restores the next", () => {
    const state = scrollAfter(showA, { type: "scrolled", position: { x: 0, y: 800 } })

    expect(transitionContextScroll(state, { type: "target.synced", sessionKey: "b", active: true })).toEqual({
      state: { status: "restoring", sessionKey: "b", attempt: 3, frame: true, applied: undefined },
      effects: [
        { type: "frame.cancel" },
        { type: "save.write", sessionKey: "a", position: { x: 0, y: 800 } },
        { type: "frame.schedule", kind: "restore", attempt: 3 },
      ],
    })
  })

  test("closing the tab stores the offset the save frame had not written yet", () => {
    const state = scrollAfter(showA, { type: "interacted" }, { type: "scrolled", position: { x: 0, y: 420 } })

    expect(transitionContextScroll(state, { type: "disposed" })).toEqual({
      state: { status: "disposed" },
      effects: [{ type: "frame.cancel" }, { type: "save.write", sessionKey: "a", position: { x: 0, y: 420 } }],
    })
  })

  test("the restore's own scroll event is not the user's, so a clamped restore retries as content grows", () => {
    const applied = scrollAfter(showA, { type: "restore.applied", attempt: 1, applied: { x: 0, y: 200 } })
    const echoed = transitionContextScroll(applied, { type: "scrolled", position: { x: 0, y: 200 } })

    expect(echoed).toEqual({ state: { ...applied, applied: undefined }, effects: [] })
    expect(transitionContextScroll(echoed.state, { type: "content.changed" }).effects).toEqual([
      { type: "frame.schedule", kind: "restore", attempt: 2 },
    ])
  })

  test("user input cancels a scheduled restore", () => {
    expect(transitionContextScroll(scrollAfter(showA), { type: "interacted" })).toEqual({
      state: { status: "tracking", sessionKey: "a", attempt: 2, pending: undefined },
      effects: [{ type: "frame.cancel" }],
    })
  })

  test("frames of an earlier attempt are ignored", () => {
    const restoring = scrollAfter(
      showA,
      { type: "restore.applied", attempt: 1, applied: undefined },
      { type: "content.changed" },
    )

    expect(transitionContextScroll(restoring, { type: "restore.applied", attempt: 1, applied: undefined }).state).toBe(
      restoring,
    )

    const tracking = scrollAfter(
      showA,
      { type: "scrolled", position: { x: 0, y: 10 } },
      { type: "save.flushed", attempt: 2 },
    )

    expect(transitionContextScroll(tracking, { type: "save.flushed", attempt: 2 }).state).toBe(tracking)
  })

  test("a session whose layout cannot be read stores its pending offset and ignores scrolling", () => {
    const state = scrollAfter(showA, { type: "scrolled", position: { x: 0, y: 30 } })
    const hidden = transitionContextScroll(state, { type: "target.synced", sessionKey: "a", active: false })

    expect(hidden).toEqual({
      state: { status: "inactive", attempt: 3 },
      effects: [{ type: "frame.cancel" }, { type: "save.write", sessionKey: "a", position: { x: 0, y: 30 } }],
    })
    expect(transitionContextScroll(hidden.state, { type: "scrolled", position: { x: 0, y: 40 } }).state).toBe(
      hidden.state,
    )
  })
})
