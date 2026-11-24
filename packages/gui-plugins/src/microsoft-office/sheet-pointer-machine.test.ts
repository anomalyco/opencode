import { describe, expect, test } from "bun:test"
import {
  DISPOSED_SHEET_POINTER_STATE,
  IDLE_SHEET_POINTER_STATE,
  sheetPointerMoveNeeded,
  transitionSheetPointer,
  type SheetHit,
  type SheetPointerEvent,
  type SheetPointerMoved,
  type SheetPointerState,
  type SheetPointerTransition,
} from "./sheet-pointer-machine"

const down = (hit: SheetHit | undefined, options: { pointerId?: number; shift?: boolean; button?: number } = {}) =>
  ({
    type: "pointer.down",
    pointerId: options.pointerId ?? 1,
    button: options.button ?? 0,
    shift: options.shift ?? false,
    hit,
  }) satisfies SheetPointerEvent

const cell = (row: number, col: number): SheetHit => ({ kind: "cell", cell: { row, col } })

// The selection's far corner follows the drag, as the grid's selection store does.
const moved = (
  row: number,
  col: number,
  focus: { row: number; col: number },
  options: { pointerId?: number; buttons?: number } = {},
): SheetPointerMoved => ({
  type: "pointer.moved",
  pointerId: options.pointerId ?? 1,
  buttons: options.buttons ?? 1,
  row,
  col,
  focusRow: focus.row,
  focusCol: focus.col,
})

const up = (row: number, col: number, pointerId = 1): SheetPointerEvent => ({
  type: "pointer.up",
  pointerId,
  cell: { row, col },
})

const replay = (events: readonly SheetPointerEvent[], state: SheetPointerState = IDLE_SHEET_POINTER_STATE) =>
  events.reduce<SheetPointerTransition>((last, event) => transitionSheetPointer(last.state, event), {
    state,
    effects: [],
  })

describe("transitionSheetPointer", () => {
  test("a press on a cell captures the pointer and selects the cell", () => {
    const next = transitionSheetPointer(IDLE_SHEET_POINTER_STATE, down(cell(2, 3)))

    expect(next.state).toEqual({ status: "dragging", pointerId: 1, axis: "cells", pressed: { row: 2, col: 3 } })
    expect(next.effects).toEqual([
      { type: "capture-pointer", pointerId: 1 },
      { type: "select-cell", cell: { row: 2, col: 3 }, extend: false },
    ])
  })

  test("a click without a drag follows the cell's link", () => {
    const click = replay([down(cell(0, 0)), moved(0, 0, { row: 0, col: 0 }), up(0, 0)])

    expect(click.state).toBe(IDLE_SHEET_POINTER_STATE)
    expect(click.effects).toEqual([{ type: "follow-link", cell: { row: 0, col: 0 } }])
  })

  // Bug: `pressed` survived the drag, so dragging off a link cell and back onto it followed the link on release.
  test("dragging off a link cell and back onto it never follows the link", () => {
    const back = replay([down(cell(0, 0)), moved(1, 1, { row: 0, col: 0 }), moved(0, 0, { row: 1, col: 1 }), up(0, 0)])

    expect(back.state).toBe(IDLE_SHEET_POINTER_STATE)
    expect(back.effects).toEqual([])
  })

  test("a shift press extends the selection and never follows a link", () => {
    const shifted = replay([down(cell(4, 4), { shift: true }), up(4, 4)])

    expect(shifted.effects).toEqual([])
    expect(transitionSheetPointer(IDLE_SHEET_POINTER_STATE, down(cell(4, 4), { shift: true })).effects).toContainEqual({
      type: "select-cell",
      cell: { row: 4, col: 4 },
      extend: true,
    })
  })

  // Bug: with no `lostpointercapture` handler, a drag whose capture was lost kept extending the selection on hover.
  test("a lost capture ends the drag, and later moves extend nothing", () => {
    const lost = replay([down(cell(0, 0)), { type: "pointer.cancelled", pointerId: 1 }])

    expect(lost.state).toBe(IDLE_SHEET_POINTER_STATE)

    const hover = transitionSheetPointer(lost.state, moved(5, 5, { row: 0, col: 0 }))

    expect(hover.state).toBe(IDLE_SHEET_POINTER_STATE)
    expect(hover.effects).toEqual([])
  })

  test("a move with the button up ends a drag whose release never reached the grid", () => {
    const dragging = replay([down(cell(0, 0))]).state
    const missed = moved(5, 5, { row: 0, col: 0 }, { buttons: 0 })

    expect(sheetPointerMoveNeeded(dragging, missed)).toBe(true)
    expect(transitionSheetPointer(dragging, missed)).toEqual({ state: IDLE_SHEET_POINTER_STATE, effects: [] })
  })

  test("moves within one cell dispatch nothing and keep the same state", () => {
    const dragging = replay([down(cell(0, 0)), moved(2, 2, { row: 0, col: 0 })]).state
    const within = moved(2, 2, { row: 2, col: 2 })

    expect(sheetPointerMoveNeeded(dragging, within)).toBe(false)
    expect(transitionSheetPointer(dragging, within).state).toBe(dragging)
    expect(sheetPointerMoveNeeded(dragging, moved(-1, -1, { row: 2, col: 2 }))).toBe(false)
  })

  test("a press on its cell needs the move that leaves it, to forget the link", () => {
    const pressed = replay([down(cell(0, 0))]).state
    const away = moved(0, 1, { row: 0, col: 1 })

    expect(sheetPointerMoveNeeded(pressed, away)).toBe(true)
    expect(transitionSheetPointer(pressed, away)).toEqual({
      state: { status: "dragging", pointerId: 1, axis: "cells", pressed: undefined },
      effects: [],
    })
  })

  test("a drag moves the selection's far corner", () => {
    const drag = replay([down(cell(0, 0)), moved(3, 4, { row: 0, col: 0 })])

    expect(drag.effects).toEqual([{ type: "extend-selection", focus: { row: 3, col: 4 } }])
  })

  test("headers drag along their axis only", () => {
    const rows = replay([down({ kind: "row", cell: { row: 5, col: 0 } })])

    expect(rows.state).toEqual({ status: "dragging", pointerId: 1, axis: "rows" })
    expect(rows.effects).toContainEqual({ type: "select-row", row: 5, extend: false })
    expect(transitionSheetPointer(rows.state, moved(8, 3, { row: 5, col: 0 })).effects).toEqual([
      { type: "extend-selection", focus: { row: 8, col: 0 } },
    ])

    const columns = replay([down({ kind: "column", cell: { row: 0, col: 2 } }, { shift: true })])

    expect(columns.state).toEqual({ status: "dragging", pointerId: 1, axis: "columns" })
    expect(columns.effects).toContainEqual({ type: "select-column", col: 2, extend: true })
    expect(transitionSheetPointer(columns.state, moved(8, 3, { row: 0, col: 2 })).effects).toEqual([
      { type: "extend-selection", focus: { row: 0, col: 3 } },
    ])
    expect(sheetPointerMoveNeeded(columns.state, moved(9, 2, { row: 0, col: 2 }))).toBe(false)
    expect(replay([down({ kind: "column", cell: { row: 0, col: 2 } }), up(0, 2)]).effects).toEqual([])
  })

  test("the select-all corner selects everything without capturing the pointer", () => {
    const all = transitionSheetPointer(IDLE_SHEET_POINTER_STATE, down({ kind: "all", cell: { row: 0, col: 0 } }))

    expect(all).toEqual({ state: IDLE_SHEET_POINTER_STATE, effects: [{ type: "select-all" }] })
  })

  test("a press off the cells or with another button does nothing", () => {
    expect(transitionSheetPointer(IDLE_SHEET_POINTER_STATE, down(undefined)).effects).toEqual([])
    expect(transitionSheetPointer(IDLE_SHEET_POINTER_STATE, down(cell(0, 0), { button: 2 })).effects).toEqual([])
  })

  test("a second pointer never starts, moves or ends another pointer's drag", () => {
    const dragging = replay([down(cell(0, 0))]).state
    const second = { pointerId: 2 }

    expect(transitionSheetPointer(dragging, down(cell(5, 5), second)).state).toBe(dragging)
    expect(sheetPointerMoveNeeded(dragging, moved(5, 5, { row: 0, col: 0 }, second))).toBe(false)
    expect(transitionSheetPointer(dragging, moved(5, 5, { row: 0, col: 0 }, second)).state).toBe(dragging)
    expect(transitionSheetPointer(dragging, up(0, 0, 2))).toEqual({ state: dragging, effects: [] })
    expect(transitionSheetPointer(dragging, { type: "pointer.cancelled", pointerId: 2 }).state).toBe(dragging)
  })

  test("disposal ignores every later event", () => {
    const disposed = replay([down(cell(0, 0)), { type: "disposed" }])

    expect(disposed.state).toBe(DISPOSED_SHEET_POINTER_STATE)
    expect(transitionSheetPointer(disposed.state, up(0, 0))).toEqual({
      state: DISPOSED_SHEET_POINTER_STATE,
      effects: [],
    })
    expect(transitionSheetPointer(disposed.state, down(cell(1, 1))).effects).toEqual([])
  })
})
