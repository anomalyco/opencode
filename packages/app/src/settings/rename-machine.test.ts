import { describe, expect, test } from "bun:test"
import {
  INITIAL_INLINE_RENAME_STATE,
  INLINE_RENAME_TIMEOUT_MS,
  selectInlineRenameDraft,
  selectInlineRenameMenuOpen,
  selectInlineRenameOpen,
  selectInlineRenameSaving,
  transitionInlineRename,
  type InlineRenameEffect,
  type InlineRenameEvent,
  type InlineRenameState,
} from "./rename-machine"

function replay(events: InlineRenameEvent[], state = INITIAL_INLINE_RENAME_STATE) {
  return events.reduce<{ state: InlineRenameState; effects: readonly InlineRenameEffect[] }>(
    (step, event) => transitionInlineRename(step.state, event),
    { state, effects: [] },
  )
}

const editing: InlineRenameEvent[] = [
  { type: "started", value: "Work" },
  { type: "input", draft: " Shared " },
]

const saving: InlineRenameEvent[] = [...editing, { type: "submitted", currentValue: "Work" }]

describe("inline rename machine", () => {
  test.each(["Work", " ", ""])("Enter on %p closes once; the closing field's blur does nothing", (draft) => {
    const closed = replay([
      { type: "started", value: "Work" },
      { type: "input", draft },
      { type: "submitted", currentValue: "Work" },
    ])

    expect(closed.state.status).toBe("closed")
    expect(closed.effects).toEqual([{ type: "closed.notify" }, { type: "focus.trigger", ifOwned: false }])

    const blurred = transitionInlineRename(closed.state, { type: "blurred", policy: "submit", currentValue: "Work" })
    expect(blurred.state).toBe(closed.state)
    expect(blurred.effects).toEqual([])
  })

  test("the field stays open and read-only while saving, and Escape cancels a save that hangs", () => {
    const pending = replay(saving)
    expect(pending.effects).toEqual([
      { type: "save.run", attempt: 1, value: "Shared", timeoutMs: INLINE_RENAME_TIMEOUT_MS },
    ])
    expect(selectInlineRenameOpen(pending.state)).toBe(true)
    expect(selectInlineRenameSaving(pending.state)).toBe(true)
    expect(selectInlineRenameDraft(pending.state)).toBe(" Shared ")

    const cancelled = replay([{ type: "cancelled" }], pending.state)
    expect(cancelled.state.status).toBe("closed")
    expect(cancelled.effects).toEqual([
      { type: "save.cancel" },
      { type: "closed.notify" },
      { type: "focus.trigger", ifOwned: false },
    ])
    expect(transitionInlineRename(cancelled.state, { type: "save.succeeded", attempt: 1 }).state).toBe(cancelled.state)
  })

  test.each(["submit", "cancel"] as const)("a %s blur while saving lets the save finish without stealing focus", (policy) => {
    const pending = replay(saving)
    expect(transitionInlineRename(pending.state, { type: "blurred", policy, currentValue: "Work" }).state).toBe(
      pending.state,
    )

    const saved = replay([{ type: "save.succeeded", attempt: 1 }], pending.state)
    expect(saved.state.status).toBe("closed")
    expect(saved.effects).toEqual([{ type: "closed.notify" }, { type: "focus.trigger", ifOwned: true }])
  })

  test("a submitting blur saves a changed name; a discarding blur closes without moving focus", () => {
    expect(replay([...editing, { type: "blurred", policy: "submit", currentValue: "Work" }]).effects).toEqual([
      { type: "save.run", attempt: 1, value: "Shared", timeoutMs: INLINE_RENAME_TIMEOUT_MS },
    ])

    const discarded = replay([...editing, { type: "blurred", policy: "cancel", currentValue: "Work" }])
    expect(discarded.state.status).toBe("closed")
    expect(discarded.effects).toEqual([{ type: "closed.notify" }])
  })

  test("a failed save returns to the draft only if focus is still the field's", () => {
    const failed = replay([...saving, { type: "save.failed", attempt: 1 }])
    expect(failed.state).toEqual({ status: "editing", issued: 1, draft: " Shared " })
    expect(failed.effects).toEqual([{ type: "focus.input", select: false, ifOwned: true }])
  })

  test("a save that times out reports it, keeps the draft and ignores its late answer", () => {
    const timedOut = replay([...saving, { type: "save.timed-out", attempt: 1 }])
    expect(timedOut.state).toEqual({ status: "editing", issued: 1, draft: " Shared " })
    expect(timedOut.effects).toEqual([{ type: "toast.timeout" }, { type: "focus.input", select: false, ifOwned: true }])
    expect(transitionInlineRename(timedOut.state, { type: "save.succeeded", attempt: 1 }).state).toBe(timedOut.state)

    const retried = replay([{ type: "submitted", currentValue: "Work" }], timedOut.state)
    expect(retried.state).toMatchObject({ status: "saving", attempt: 2 })
  })

  test("the options menu opens and closes, and Rename from it focuses the selected field", () => {
    const menu = replay([{ type: "menu.changed", open: true }])
    expect(selectInlineRenameMenuOpen(menu.state)).toBe(true)

    const started = replay([{ type: "started", value: "rebase" }], menu.state)
    expect(selectInlineRenameMenuOpen(started.state)).toBe(false)
    expect(started.effects).toEqual([{ type: "focus.input", select: true, ifOwned: false }])
    expect(transitionInlineRename(started.state, { type: "menu.changed", open: false }).state).toBe(started.state)
  })

  test("a field remounted while saving still closes the rename once the save lands", () => {
    const disposed = replay([...saving, { type: "disposed" }])
    expect(disposed.effects).toEqual([{ type: "save.cancel" }, { type: "focus.cancel" }])

    const failed = transitionInlineRename(disposed.state, { type: "save.failed", attempt: 1 })
    expect(failed.state).toBe(disposed.state)
    expect(failed.effects).toEqual([])

    const saved = replay([{ type: "save.succeeded", attempt: 1 }], disposed.state)
    expect(saved.effects).toEqual([{ type: "closed.notify" }])
    expect(transitionInlineRename(saved.state, { type: "save.succeeded", attempt: 1 }).effects).toEqual([])
  })
})
