import { describe, expect, test } from "bun:test"
import {
  createFileSelectionState,
  DISPOSED_FILE_SELECTION_STATE,
  NO_SELECTION_EFFECTS,
  selectPointerTracking,
  transitionFileSelection,
  type FileSelectionEvent,
  type FileSelectionTransition,
} from "./selection-machine"

const down = (line: number | undefined, column: "text" | "numbers" = "numbers") =>
  ({ type: "pointer.down", button: 0, column, line, side: undefined, touch: false }) as const

const tap = (line: number, side?: "additions" | "deletions") =>
  ({ type: "pointer.down", button: 0, column: "text", line, side, touch: true }) as const

const move = (line: number | undefined, buttons = 1) => ({ type: "pointer.move", buttons, line }) as const

const up = { type: "pointer.up" } as const

function run(events: FileSelectionEvent[], state = createFileSelectionState()): FileSelectionTransition {
  return events.reduce((result, event) => transitionFileSelection(result.state, event), {
    state,
    effects: NO_SELECTION_EFFECTS,
  })
}

describe("file line selection", () => {
  test("pressing and dragging over the code leaves the lines to the text selection", () => {
    const selected = run([{ type: "selection.controlled", range: { start: 2, end: 2 } }])
    const dragged = run([down(5, "text"), move(7), up], selected.state)

    expect(dragged.state).toBe(selected.state)
    expect(dragged.effects).toBe(NO_SELECTION_EFFECTS)
    expect(selectPointerTracking(dragged.state)).toBe(false)
  })

  test("a tap on the code toggles that line on touch screens, where line numbers can be hidden", () => {
    const selected = run([tap(5, "additions"), up])
    expect(selected.state).toMatchObject({ status: "idle", selected: { start: 5, end: 5, side: "additions" } })
    expect(selected.effects).toEqual([
      { type: "apply-selection", range: { start: 5, end: 5, side: "additions" } },
      { type: "notify-selection-end", range: { start: 5, end: 5, side: "additions" }, fromNumberDrag: false },
    ])

    const cleared = run([tap(5, "additions"), up], selected.state)
    expect(cleared.effects).toEqual([
      { type: "apply-selection", range: null },
      { type: "notify-selection-end", range: null, fromNumberDrag: false },
    ])
  })

  test("a touch that scrolls, long-presses or moves to another line selects nothing", () => {
    expect(run([tap(5), { type: "pointer.cancelled" }, up]).effects).toBe(NO_SELECTION_EFFECTS)
    expect(run([tap(5), move(6), up]).effects).toBe(NO_SELECTION_EFFECTS)
  })

  test("disabling selection mid-press ends the gesture", () => {
    const pressing = run([down(5), move(7)])
    expect(pressing.state).toMatchObject({ status: "dragging", attempt: 1 })

    const disabled = transitionFileSelection(pressing.state, { type: "selection.disabled" })
    expect(disabled.state).toEqual({ status: "idle", selected: null, attempt: 2 })
    expect(disabled.effects).toBe(NO_SELECTION_EFFECTS)
  })

  test("a line-number drag reports itself once and leaves nothing pending", () => {
    // Pierre ends the gesture on its document pointerup, before our window mouseup.
    const ended = run([down(1), move(4), { type: "pierre.selection-ended", range: { start: 1, end: 4 } }])
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
    for (const end of [move(4, 0), up]) {
      const ended = run([down(1), move(4), end])
      expect(ended.state).toMatchObject({ status: "idle", attempt: 2 })

      const next = transitionFileSelection(ended.state, { type: "pierre.selection-ended", range: { start: 3, end: 6 } })
      expect(next.effects).toEqual([
        { type: "notify-selection-end", range: { start: 3, end: 6 }, fromNumberDrag: false },
      ])
    }
  })

  test("a single-line number click is not a number drag", () => {
    const ended = run([down(3), move(3), { type: "pierre.selection-ended", range: { start: 3, end: 3 } }])

    expect(ended.effects).toEqual([
      { type: "notify-selection-end", range: { start: 3, end: 3 }, fromNumberDrag: false },
    ])
  })

  test("a controlled range applies unless it is the range already shown", () => {
    const shown = run([{ type: "selection.controlled", range: { start: 5, end: 5 } }])
    const selected = shown.state.status === "idle" ? shown.state.selected : null

    if (!selected) throw new Error("expected a selection")

    const same = transitionFileSelection(shown.state, { type: "selection.controlled", range: selected })
    expect(same.state).toBe(shown.state)
    expect(same.effects).toBe(NO_SELECTION_EFFECTS)

    // A restored draft hands back a copy of the range.
    const copy = transitionFileSelection(shown.state, { type: "selection.controlled", range: { ...selected } })
    expect(copy.effects).toEqual([{ type: "apply-selection", range: { start: 5, end: 5 } }])
  })

  test("Pierre's committed range updates the shown range without ending a gesture", () => {
    const dragging = run([down(2), move(4)])
    const step = transitionFileSelection(dragging.state, { type: "pierre.line-selected", range: { start: 2, end: 4 } })

    expect(step.state).toMatchObject({ status: "dragging", selected: { start: 2, end: 4 } })
    expect(step.effects).toEqual([{ type: "notify-line-selected", range: { start: 2, end: 4 } }])
  })

  test("hovering does no work and repeated moves keep the same state", () => {
    const idle = createFileSelectionState()
    const dragging = run([down(2), move(4)])

    expect(selectPointerTracking(idle)).toBe(false)
    expect(selectPointerTracking(DISPOSED_FILE_SELECTION_STATE)).toBe(false)
    expect(selectPointerTracking(dragging.state)).toBe(true)

    const same = transitionFileSelection(dragging.state, move(6))
    expect(same.state).toBe(dragging.state)
    expect(same.effects).toBe(NO_SELECTION_EFFECTS)
  })

  test("disposing ignores later events", () => {
    const state = run([down(2), move(4), { type: "disposed" }]).state
    expect(state).toBe(DISPOSED_FILE_SELECTION_STATE)

    for (const event of [down(1), move(3), up] as const)
      expect(transitionFileSelection(state, event).effects).toBe(NO_SELECTION_EFFECTS)
  })
})
