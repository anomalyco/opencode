import { describe, expect, test } from "bun:test"
import {
  createFileSelectionState,
  DISPOSED_FILE_SELECTION_STATE,
  NO_SELECTION_EFFECTS,
  selectPointerTracking,
  transitionFileSelection,
  type FileSelectionEvent,
  type FileSelectionState,
  type FileSelectionTransition,
} from "./selection-machine"

const down = (line: number | undefined, column: "text" | "numbers" = "text", side?: "additions" | "deletions") =>
  ({ type: "pointer.down", button: 0, column, line, side }) as const

const move = (line: number | undefined, side?: "additions" | "deletions", buttons = 1) =>
  ({ type: "pointer.move", buttons, line, side }) as const

const up = { type: "pointer.up" } as const

function run(events: FileSelectionEvent[], state = createFileSelectionState("text")): FileSelectionTransition {
  return events.reduce((result, event) => transitionFileSelection(result.state, event), {
    state,
    effects: NO_SELECTION_EFFECTS,
  })
}

function effects(events: FileSelectionEvent[], state: FileSelectionState) {
  return events.map((event) => {
    const step = transitionFileSelection(state, event)
    state = step.state

    return step.effects
  })
}

describe("file line selection", () => {
  test("disabling selection mid-drag ends the gesture and drops its frames", () => {
    const dragging = run([down(5), move(7)])
    expect(dragging.state).toMatchObject({ status: "dragging", column: "text", attempt: 1 })

    const disabled = transitionFileSelection(dragging.state, { type: "selection.disabled" })
    expect(disabled.state).toEqual({ status: "idle", mode: "text", selected: null, attempt: 2 })
    expect(disabled.effects).toEqual([{ type: "cancel-frames" }])

    for (const event of [{ type: "selection.changed" }, { type: "drag.frame", attempt: 1 }, move(9)] as const) {
      const step = transitionFileSelection(disabled.state, event)
      expect(step.state).toBe(disabled.state)
      expect(step.effects).toBe(NO_SELECTION_EFFECTS)
    }
  })

  test("a second press before the finishing frame drops the first drag's frame", () => {
    const finishing = run([down(2), move(5), up])
    expect(finishing.state).toMatchObject({ status: "finishing", attempt: 2, range: { start: 2, end: 5 } })
    expect(finishing.effects).toEqual([{ type: "cancel-frames" }, { type: "schedule-finish", attempt: 2 }])

    const pressed = transitionFileSelection(finishing.state, down(10))
    expect(pressed.state).toMatchObject({ status: "pressing", attempt: 3, origin: { line: 10 } })
    expect(pressed.effects).toEqual([{ type: "cancel-frames" }])

    const stale = transitionFileSelection(pressed.state, {
      type: "finish.frame",
      attempt: 2,
      range: { start: 10, end: 10 },
    })

    expect(stale.state).toBe(pressed.state)
    expect(stale.effects).toBe(NO_SELECTION_EFFECTS)
  })

  test("a drag over whitespace commits its end points when the text selection is collapsed", () => {
    const finishing = run([down(5), move(8), up])
    const done = transitionFileSelection(finishing.state, { type: "finish.frame", attempt: 2, range: undefined })

    expect(done.state).toEqual({ status: "idle", mode: "text", selected: { start: 5, end: 8 }, attempt: 2 })
    expect(done.effects).toEqual([
      { type: "apply-selection", range: { start: 5, end: 8 }, preserveText: false },
      { type: "notify-selection-end", range: { start: 5, end: 8 }, fromNumberDrag: false },
    ])
  })

  test("a line-number drag reports itself once and leaves nothing pending", () => {
    // Pierre ends the gesture on its document pointerup, before our window mouseup.
    const ended = run([down(1, "numbers"), move(4), { type: "pierre.selection-ended", range: { start: 1, end: 4 } }])
    expect(ended.effects).toEqual([{ type: "notify-selection-end", range: { start: 1, end: 4 }, fromNumberDrag: true }])
    expect(ended.state).toMatchObject({ status: "idle" })

    const released = transitionFileSelection(ended.state, up)
    expect(released.state).toBe(ended.state)

    const later = transitionFileSelection(released.state, {
      type: "pierre.selection-ended",
      range: { start: 10, end: 12 },
    })

    expect(later.effects).toEqual([
      { type: "notify-selection-end", range: { start: 10, end: 12 }, fromNumberDrag: false },
    ])
  })

  test("a line-number press that ends without Pierre's callback leaves nothing pending", () => {
    for (const end of [move(4, undefined, 0), up]) {
      const ended = run([down(1, "numbers"), move(4), end])
      expect(ended.state).toMatchObject({ status: "idle", attempt: 2 })

      const next = transitionFileSelection(ended.state, { type: "pierre.selection-ended", range: { start: 3, end: 6 } })
      expect(next.effects).toEqual([
        { type: "notify-selection-end", range: { start: 3, end: 6 }, fromNumberDrag: false },
      ])
    }
  })

  test("a single-line number click is not a number drag", () => {
    const ended = run([down(3, "numbers"), move(3), { type: "pierre.selection-ended", range: { start: 3, end: 3 } }])

    expect(ended.effects).toEqual([
      { type: "notify-selection-end", range: { start: 3, end: 3 }, fromNumberDrag: false },
    ])
  })

  test("a click toggles one line, even when the pointer jitters on that line", () => {
    const selected = run([down(5), move(5), up])
    expect(selected.state).toMatchObject({ status: "idle", selected: { start: 5, end: 5 } })
    expect(selected.effects).toEqual([
      { type: "apply-selection", range: { start: 5, end: 5 }, preserveText: false },
      { type: "notify-selection-end", range: { start: 5, end: 5 }, fromNumberDrag: false },
    ])

    const cleared = run([down(5), up], selected.state)
    expect(cleared.state).toMatchObject({ status: "idle", selected: null })
    expect(cleared.effects).toEqual([
      { type: "apply-selection", range: null, preserveText: false },
      { type: "notify-selection-end", range: null, fromNumberDrag: false },
    ])
  })

  test("selecting characters on one line keeps the text selection", () => {
    const finishing = run([down(5), { type: "selection.changed" }, up])
    expect(finishing.state).toMatchObject({ status: "finishing", range: { start: 5, end: 5 } })

    const done = transitionFileSelection(finishing.state, {
      type: "finish.frame",
      attempt: 2,
      range: { start: 5, end: 5, side: "additions" },
    })

    expect(done.effects).toEqual([
      { type: "apply-selection", range: { start: 5, end: 5, side: "additions" }, preserveText: true },
      { type: "notify-selection-end", range: { start: 5, end: 5, side: "additions" }, fromNumberDrag: false },
    ])
  })

  test("drag frames apply the latest end point and stale ones do nothing", () => {
    const dragging = run([down(2), move(4), move(6)])
    const frame = transitionFileSelection(dragging.state, { type: "drag.frame", attempt: 1 })

    expect(frame.state).toMatchObject({ status: "dragging", selected: { start: 2, end: 6 } })
    expect(frame.effects).toEqual([{ type: "apply-selection", range: { start: 2, end: 6 }, preserveText: false }])
    expect(transitionFileSelection(dragging.state, { type: "drag.frame", attempt: 0 }).state).toBe(dragging.state)
  })

  test("a button released outside the window ends the drag", () => {
    const step = run([down(2), move(4), move(undefined, undefined, 0)])

    expect(step.state).toMatchObject({ status: "idle", attempt: 2 })
    expect(step.effects).toEqual([{ type: "cancel-frames" }])
  })

  test("a diff drag keeps its direction and both sides", () => {
    const finishing = run([down(20, "text", "deletions"), move(15, "additions"), up], createFileSelectionState("diff"))

    expect(finishing.state).toMatchObject({
      status: "finishing",
      range: { start: 20, end: 15, side: "deletions", endSide: "additions" },
    })
  })

  test("a controlled range applies unless it is the range already shown", () => {
    const shown = run([down(5), up])
    const selected = shown.state.status === "idle" ? shown.state.selected : null

    if (!selected) throw new Error("expected a selection")

    const same = transitionFileSelection(shown.state, { type: "selection.controlled", range: selected })
    expect(same.state).toBe(shown.state)
    expect(same.effects).toBe(NO_SELECTION_EFFECTS)

    // A restored draft hands back a copy of the range.
    const copy = transitionFileSelection(shown.state, { type: "selection.controlled", range: { ...selected } })
    expect(copy.effects).toEqual([{ type: "apply-selection", range: { start: 5, end: 5 }, preserveText: false }])
  })

  test("Pierre's committed range updates the shown range without ending a gesture", () => {
    const dragging = run([down(2), move(4)])
    const step = transitionFileSelection(dragging.state, { type: "pierre.line-selected", range: { start: 2, end: 4 } })

    expect(step.state).toMatchObject({ status: "dragging", selected: { start: 2, end: 4 } })
    expect(step.effects).toEqual([{ type: "notify-line-selected", range: { start: 2, end: 4 } }])
  })

  test("hovering does no work and repeated moves on one line keep the same state", () => {
    const idle = createFileSelectionState("text")
    const dragging = run([down(2), move(4)])
    const finishing = run([up], dragging.state)

    expect(selectPointerTracking(idle)).toBe(false)
    expect(selectPointerTracking(finishing.state)).toBe(false)
    expect(selectPointerTracking(DISPOSED_FILE_SELECTION_STATE)).toBe(false)
    expect(selectPointerTracking(dragging.state)).toBe(true)

    const same = transitionFileSelection(dragging.state, move(4))
    expect(same.state).toBe(dragging.state)
    expect(same.effects).toBe(NO_SELECTION_EFFECTS)
  })

  test("disposing drops pending frames and ignores later events", () => {
    const disposed = run([down(2), move(4), { type: "disposed" }])
    expect(disposed.state).toBe(DISPOSED_FILE_SELECTION_STATE)
    expect(disposed.effects).toEqual([{ type: "cancel-frames" }])

    expect(
      effects(
        [down(1), move(3), up, { type: "finish.frame", attempt: 2, range: undefined }],
        DISPOSED_FILE_SELECTION_STATE,
      ),
    ).toEqual([NO_SELECTION_EFFECTS, NO_SELECTION_EFFECTS, NO_SELECTION_EFFECTS, NO_SELECTION_EFFECTS])
  })
})
