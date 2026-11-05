import { describe, expect, test } from "bun:test"
import {
  INITIAL_BRANCH_PICKER_STATE,
  selectBranchBusy,
  selectBranchInitial,
  selectBranchPending,
  selectBranchPopoverOpen,
  transitionBranchPicker,
  type BranchPickerEffect,
  type BranchPickerEvent,
  type BranchPickerState,
} from "./branch-machine"

function replay(events: BranchPickerEvent[], state = INITIAL_BRANCH_PICKER_STATE) {
  return events.reduce<{ state: BranchPickerState; effects: readonly BranchPickerEffect[] }>(
    (step, event) => transitionBranchPicker(step.state, event),
    { state, effects: [] },
  )
}

const target = (directory: string | undefined): BranchPickerEvent => ({ type: "target.changed", directory })
const open: BranchPickerEvent = { type: "open.change", open: true }
const close: BranchPickerEvent = { type: "open.change", open: false }
const loaded = (attempt: number, items = ["dev", "main"]): BranchPickerEvent => ({
  type: "branches.loaded",
  attempt,
  items,
})
const focus: BranchPickerEffect = { type: "focus.composer" }

describe("branch picker", () => {
  test("preloads branches for the project root and opens on them", () => {
    const start = replay([target("/repo-a")])
    expect(start.state).toEqual({ status: "loading", directory: "/repo-a", attempt: 1, open: false })
    expect(start.effects).toEqual([{ type: "branches.fetch", attempt: 1, directory: "/repo-a" }])
    expect(selectBranchBusy(start.state)).toBe(true)

    const ready = replay([loaded(1)], start.state)
    expect(selectBranchInitial(ready.state)).toEqual({ items: ["dev", "main"], failed: false })
    expect(selectBranchPopoverOpen(ready.state)).toBe(false)

    // Every open revalidates while the loaded list stays on screen.
    const opened = transitionBranchPicker(ready.state, open)
    expect(selectBranchPopoverOpen(opened.state)).toBe(true)
    expect(selectBranchBusy(opened.state)).toBe(true)
    expect(opened.effects).toEqual([{ type: "branches.fetch", attempt: 2, directory: "/repo-a" }])
    expect(selectBranchInitial(opened.state)).toEqual({ items: ["dev", "main"], failed: false })

    const refreshed = transitionBranchPicker(opened.state, loaded(2, ["dev", "feature/new"]))
    expect(selectBranchInitial(refreshed.state)).toEqual({ items: ["dev", "feature/new"], failed: false })
    expect(selectBranchBusy(refreshed.state)).toBe(false)
  })

  test("a pending open opens once branches arrive, and can be dismissed first", () => {
    const pending = replay([target("/repo-a"), open])
    expect(selectBranchPending(pending.state)).toBe(true)
    expect(selectBranchPopoverOpen(pending.state)).toBe(true)
    expect(selectBranchInitial(pending.state)).toBeUndefined()

    expect(selectBranchPopoverOpen(transitionBranchPicker(pending.state, loaded(1)).state)).toBe(true)

    const dismissed = transitionBranchPicker(pending.state, { type: "pending.dismiss" })
    expect(dismissed.effects).toEqual([])
    expect(selectBranchPopoverOpen(transitionBranchPicker(dismissed.state, loaded(1)).state)).toBe(false)
  })

  // Bug: `open` stayed true across a project root change, so the new root's preload popped the picker open.
  test("a project root change closes a pending picker and preloads the new root closed", () => {
    const pending = replay([target("/repo-a"), open])
    const moved = transitionBranchPicker(pending.state, target("/repo-b"))
    expect(moved.state).toEqual({ status: "loading", directory: "/repo-b", attempt: 2, open: false })
    expect(moved.effects).toEqual([
      { type: "branches.abort", attempt: 1 },
      { type: "branches.fetch", attempt: 2, directory: "/repo-b" },
    ])
    expect(selectBranchPopoverOpen(moved.state)).toBe(false)

    expect(transitionBranchPicker(moved.state, loaded(1)).state).toBe(moved.state)
    expect(selectBranchPopoverOpen(transitionBranchPicker(moved.state, loaded(2)).state)).toBe(false)
  })

  test("a project root change closes an open picker and drops its revalidation", () => {
    const opened = replay([target("/repo-a"), loaded(1), open])
    const moved = transitionBranchPicker(opened.state, target("/repo-b"))
    expect(moved.effects).toEqual([
      { type: "branches.abort", attempt: 2 },
      { type: "branches.fetch", attempt: 3, directory: "/repo-b" },
    ])
    expect(selectBranchPopoverOpen(moved.state)).toBe(false)
    expect(selectBranchInitial(moved.state)).toBeUndefined()
    expect(selectBranchPopoverOpen(transitionBranchPicker(moved.state, loaded(3)).state)).toBe(false)
  })

  // Bug: an outside interaction that never reached `onCloseAutoFocus` left `outside` set, so the next open skipped
  // returning focus to the composer.
  test("an outside interaction does not suppress focus on a later open", () => {
    const outside = replay([target("/repo-a"), loaded(1), open, { type: "interact.outside" }])
    expect(transitionBranchPicker(outside.state, close).effects).toEqual([])

    // The picker unmounts before Kobalte closes it, then the draft returns to the same root.
    const reopened = replay([target(undefined), target("/repo-a"), loaded(4), open], outside.state)
    expect(selectBranchPopoverOpen(reopened.state)).toBe(true)
    expect(transitionBranchPicker(reopened.state, { type: "branch.selected", branch: "dev" }).effects).toEqual([
      { type: "branch.choose", branch: "dev" },
      focus,
    ])
    expect(transitionBranchPicker(reopened.state, close).effects).toEqual([focus])

    // Closing an outside-dismissed picker and opening it again also starts clean.
    const again = replay([close, open], outside.state)
    expect(transitionBranchPicker(again.state, close).effects).toEqual([focus])
  })

  // Bug: a slow revalidation that failed after the picker's own search answered replaced the list with an error.
  test("the picker's own empty search supersedes a revalidation in flight", () => {
    const failed = replay([target("/repo-a"), { type: "branches.failed", attempt: 1 }])
    expect(selectBranchInitial(failed.state)).toEqual({ items: [], failed: true })

    const opened = transitionBranchPicker(failed.state, open)
    expect(opened.effects).toEqual([{ type: "branches.fetch", attempt: 2, directory: "/repo-a" }])

    const synced = transitionBranchPicker(opened.state, {
      type: "branches.synced",
      directory: "/repo-a",
      items: ["main", "dev"],
    })
    expect(synced.effects).toEqual([{ type: "branches.abort", attempt: 2 }])
    expect(selectBranchInitial(synced.state)).toEqual({ items: ["main", "dev"], failed: false })
    expect(selectBranchBusy(synced.state)).toBe(false)

    expect(transitionBranchPicker(synced.state, { type: "branches.failed", attempt: 2 }).state).toBe(synced.state)
    expect(transitionBranchPicker(synced.state, loaded(2, ["old"])).state).toBe(synced.state)
    expect(transitionBranchPicker(synced.state, { type: "branches.timed-out", attempt: 2 }).state).toBe(synced.state)

    const elsewhere = { type: "branches.synced", directory: "/repo-b", items: ["x"] } as const
    expect(transitionBranchPicker(opened.state, elsewhere).state).toBe(opened.state)
  })

  // Bug: the preload had no signal or deadline, so a hung request kept the trigger busy and the picker unopenable.
  test("a hung preload times out into a picker that offers Retry", () => {
    const pending = replay([target("/repo-a"), open])
    const timedOut = transitionBranchPicker(pending.state, { type: "branches.timed-out", attempt: 1 })
    expect(timedOut.effects).toEqual([{ type: "branches.abort", attempt: 1 }])
    expect(selectBranchPopoverOpen(timedOut.state)).toBe(true)
    expect(selectBranchBusy(timedOut.state)).toBe(false)
    expect(selectBranchInitial(timedOut.state)).toEqual({ items: [], failed: true })
  })

  test("a failed or timed-out revalidation keeps the list on screen", () => {
    const opened = replay([target("/repo-a"), loaded(1), open])
    const failed = transitionBranchPicker(opened.state, { type: "branches.failed", attempt: 2 })
    expect(failed.effects).toEqual([])
    expect(selectBranchInitial(failed.state)).toEqual({ items: ["dev", "main"], failed: false })
    expect(selectBranchBusy(failed.state)).toBe(false)

    const timedOut = transitionBranchPicker(opened.state, { type: "branches.timed-out", attempt: 2 })
    expect(timedOut.effects).toEqual([{ type: "branches.abort", attempt: 2 }])
    expect(selectBranchInitial(timedOut.state)).toEqual({ items: ["dev", "main"], failed: false })
  })

  test("ignores results from superseded attempts", () => {
    const opened = replay([target("/repo-a"), loaded(1), open])
    for (const event of [loaded(1), { type: "branches.failed", attempt: 1 }, { type: "branches.timed-out", attempt: 1 }]) {
      expect(transitionBranchPicker(opened.state, event as BranchPickerEvent).state).toBe(opened.state)
    }

    const loading = replay([target("/repo-a"), target("/repo-b")])
    expect(transitionBranchPicker(loading.state, { type: "branches.timed-out", attempt: 1 })).toEqual({
      state: loading.state,
      effects: [],
    })
  })

  test("the shortcut toggles the picker and returns focus; the palette only opens it", () => {
    const keybind: BranchPickerEvent = { type: "command.select", source: "keybind" }
    const palette: BranchPickerEvent = { type: "command.select", source: "palette" }

    const pending = replay([target("/repo-a"), keybind])
    expect(selectBranchPending(pending.state)).toBe(true)
    expect(transitionBranchPicker(pending.state, palette).state).toBe(pending.state)
    const unpended = transitionBranchPicker(pending.state, keybind)
    expect(selectBranchPopoverOpen(unpended.state)).toBe(false)
    expect(unpended.effects).toEqual([focus])

    const opened = replay([loaded(1), keybind], unpended.state)
    expect(selectBranchPopoverOpen(opened.state)).toBe(true)
    expect(opened.effects).toEqual([{ type: "branches.fetch", attempt: 2, directory: "/repo-a" }])
    expect(transitionBranchPicker(opened.state, palette).state).toBe(opened.state)
    const closed = transitionBranchPicker(opened.state, keybind)
    expect(selectBranchPopoverOpen(closed.state)).toBe(false)
    expect(closed.effects).toEqual([focus])
  })

  test("Escape or the trigger returns focus; an outside click keeps it where the user put it", () => {
    const opened = replay([target("/repo-a"), loaded(1), open])
    expect(transitionBranchPicker(opened.state, close).effects).toEqual([focus])

    const outside = replay([{ type: "interact.outside" }, close], opened.state)
    expect(outside.effects).toEqual([])
    expect(selectBranchPopoverOpen(outside.state)).toBe(false)
  })

  test("leaving worktree creation drops the request and stays inactive", () => {
    const pending = replay([target("/repo-a"), open])
    const inactive = transitionBranchPicker(pending.state, target(undefined))
    expect(inactive.state).toEqual({ status: "inactive", attempt: 1 })
    expect(inactive.effects).toEqual([{ type: "branches.abort", attempt: 1 }])
    expect(transitionBranchPicker(inactive.state, open).state).toBe(inactive.state)
    expect(transitionBranchPicker(inactive.state, target(undefined)).state).toBe(inactive.state)
  })

  test("dispose aborts the request in flight and ignores everything after", () => {
    const opened = replay([target("/repo-a"), loaded(1), open])
    const disposed = transitionBranchPicker(opened.state, { type: "disposed" })
    expect(disposed.effects).toEqual([{ type: "branches.abort", attempt: 2 }])
    expect(transitionBranchPicker(disposed.state, loaded(2)).state).toBe(disposed.state)
    expect(transitionBranchPicker(disposed.state, target("/repo-b")).effects).toEqual([])

    expect(transitionBranchPicker(replay([target("/repo-a"), loaded(1)]).state, { type: "disposed" }).effects).toEqual(
      [],
    )
  })
})
