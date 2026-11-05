import { describe, expect, test } from "bun:test"
import {
  SESSION_RENAME_SAVE_TIMEOUT_MS,
  createSessionRenameDialogState,
  selectSessionRenameDialogView,
  transitionSessionRenameDialog,
  type SessionRenameDialogEvent,
  type SessionRenameDialogState,
} from "./session-rename-dialog-machine"

const run = (state: SessionRenameDialogState, ...events: SessionRenameDialogEvent[]) =>
  events.reduce((current, event) => transitionSessionRenameDialog(current, event).state, state)

const editing = run(createSessionRenameDialogState("Old"), { type: "input.focused" }, { type: "input.changed", value: " New " })

const saving = transitionSessionRenameDialog(editing, { type: "submitted" })

describe("session rename dialog machine", () => {
  test("saves the trimmed title and closes once it lands", () => {
    expect(saving.state).toEqual({ status: "saving", issued: 1, attempt: 1, initial: "Old", draft: " New " })
    expect(saving.effects).toEqual([
      { type: "save.start", attempt: 1, title: "New", timeoutMs: SESSION_RENAME_SAVE_TIMEOUT_MS },
    ])

    const saved = transitionSessionRenameDialog(saving.state, { type: "save.succeeded", attempt: 1, title: "New" })

    expect(saved.state).toEqual({ status: "closed", issued: 1 })
    expect(saved.effects).toEqual([{ type: "timer.clear", attempt: 1 }, { type: "dialog.close" }])
  })

  test("Cancel stays usable while a save hangs, and a late result after it changes nothing", () => {
    expect(selectSessionRenameDialogView(saving.state)).toEqual({
      draft: " New ",
      saving: true,
      inputDisabled: true,
      cancelDisabled: false,
      canSubmit: false,
    })

    const cancelled = transitionSessionRenameDialog(saving.state, { type: "cancelled" })

    expect(cancelled.state).toEqual({ status: "closed", issued: 1 })
    expect(cancelled.effects).toEqual([{ type: "timer.clear", attempt: 1 }, { type: "dialog.close" }])

    for (const event of [
      { type: "save.succeeded", attempt: 1, title: "New" },
      { type: "save.failed", attempt: 1, error: new Error() },
    ] satisfies SessionRenameDialogEvent[])
      expect(transitionSessionRenameDialog(cancelled.state, event)).toEqual({ state: cancelled.state, effects: [] })
  })

  test("Escape while saving disposes without closing another dialog or toasting later", () => {
    const disposed = transitionSessionRenameDialog(saving.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "timer.clear", attempt: 1 }])

    for (const event of [
      { type: "save.succeeded", attempt: 1, title: "New" },
      { type: "save.failed", attempt: 1, error: new Error() },
      { type: "save.timed-out", attempt: 1 },
    ] satisfies SessionRenameDialogEvent[])
      expect(transitionSessionRenameDialog(disposed.state, event).effects).toEqual([])
  })

  test("a save that times out returns to editing, and closes the dialog if it lands after all", () => {
    const timedOut = transitionSessionRenameDialog(saving.state, { type: "save.timed-out", attempt: 1 })

    expect(timedOut.state).toEqual({ status: "editing", issued: 1, initial: "Old", draft: " New ", selected: true })
    expect(timedOut.effects).toEqual([
      { type: "timer.clear", attempt: 1 },
      { type: "toast.failed", error: undefined },
      { type: "input.focus" },
    ])
    expect(selectSessionRenameDialogView(timedOut.state).cancelDisabled).toBe(false)

    const landed = transitionSessionRenameDialog(timedOut.state, { type: "save.succeeded", attempt: 1, title: "New" })

    expect(landed.state).toEqual({ status: "closed", issued: 1 })
    expect(landed.effects).toEqual([{ type: "dialog.close" }])
  })

  test("a late save under a changed draft becomes the confirmed title", () => {
    const changed = run(
      saving.state,
      { type: "save.timed-out", attempt: 1 },
      { type: "input.changed", value: "Newer" },
      { type: "save.succeeded", attempt: 1, title: "New" },
    )

    expect(changed).toEqual({ status: "editing", issued: 1, initial: "New", draft: "Newer", selected: true })

    // Submitting the landed title again closes without another request.
    const resubmitted = run(changed, { type: "input.changed", value: "New" })

    expect(transitionSessionRenameDialog(resubmitted, { type: "submitted" }).effects).toEqual([{ type: "dialog.close" }])
  })

  test("a failed save restores editing and focus without selecting the title again", () => {
    expect(transitionSessionRenameDialog(createSessionRenameDialogState("Old"), { type: "input.focused" }).effects).toEqual([
      { type: "input.select" },
    ])

    const error = new Error("boom")
    const failed = transitionSessionRenameDialog(saving.state, { type: "save.failed", attempt: 1, error })

    expect(failed.effects).toEqual([
      { type: "timer.clear", attempt: 1 },
      { type: "toast.failed", error },
      { type: "input.focus" },
    ])
    expect(transitionSessionRenameDialog(failed.state, { type: "input.focused" })).toEqual({
      state: failed.state,
      effects: [],
    })
  })

  test("a superseded save does not decide the newer one", () => {
    const retry = run(saving.state, { type: "save.timed-out", attempt: 1 }, { type: "submitted" })

    expect(retry).toMatchObject({ status: "saving", attempt: 2 })
    expect(transitionSessionRenameDialog(retry, { type: "save.succeeded", attempt: 1, title: "New" }).state).toBe(retry)
    expect(transitionSessionRenameDialog(retry, { type: "save.failed", attempt: 1, error: undefined }).state).toBe(retry)
  })

  test("a blank title does nothing and an unchanged one closes without saving", () => {
    const blank = run(createSessionRenameDialogState("Old"), { type: "input.changed", value: "  " })

    expect(transitionSessionRenameDialog(blank, { type: "submitted" })).toEqual({ state: blank, effects: [] })
    expect(selectSessionRenameDialogView(blank).canSubmit).toBe(false)

    const unchanged = run(createSessionRenameDialogState("Old"), { type: "input.changed", value: " Old" })

    expect(transitionSessionRenameDialog(unchanged, { type: "submitted" })).toEqual({
      state: { status: "closed", issued: 0 },
      effects: [{ type: "dialog.close" }],
    })
  })

  test("while saving, typing and submitting again are ignored", () => {
    expect(transitionSessionRenameDialog(saving.state, { type: "submitted" }).state).toBe(saving.state)
    expect(transitionSessionRenameDialog(saving.state, { type: "input.changed", value: "x" }).state).toBe(saving.state)
  })
})
