import type { CellAddr } from "@betteroffice/xlsx/headless"

/** What a drag moves the selection's far corner along. */
export type SheetDragAxis = "cells" | "rows" | "columns"

/** Where a pointer went down: a cell, a whole row or column header, or the corner that selects all. */
export type SheetHit = {
  readonly kind: "all" | "column" | "row" | "cell"
  readonly cell: CellAddr
}

/** A grid's pointer gesture. Only the pointer that started a drag moves or ends it. */
export type SheetPointerState =
  | { readonly status: "idle" }
  | {
      readonly status: "dragging"
      readonly pointerId: number
      readonly axis: "cells"
      /** The cell a plain press went down on, which a release on it follows; cleared once the drag leaves it. */
      readonly pressed: CellAddr | undefined
    }
  | { readonly status: "dragging"; readonly pointerId: number; readonly axis: "rows" | "columns" }
  | { readonly status: "disposed" }

/** A pointer move during a drag. The grid reuses one object for every move. */
export type SheetPointerMoved = {
  readonly type: "pointer.moved"
  readonly pointerId: number
  readonly buttons: number
  /** `-1` when no cell is under the pointer. */
  readonly row: number
  readonly col: number
  /** The selection's far corner now. */
  readonly focusRow: number
  readonly focusCol: number
}

export type SheetPointerEvent =
  | {
      readonly type: "pointer.down"
      readonly pointerId: number
      readonly button: number
      readonly shift: boolean
      readonly hit: SheetHit | undefined
    }
  | SheetPointerMoved
  | { readonly type: "pointer.up"; readonly pointerId: number; readonly cell: CellAddr | undefined }
  /** `pointercancel` or `lostpointercapture`: ends the drag without following a link. */
  | { readonly type: "pointer.cancelled"; readonly pointerId: number }
  | { readonly type: "disposed" }

export type SheetPointerEffect =
  | { readonly type: "capture-pointer"; readonly pointerId: number }
  | { readonly type: "select-all" }
  | { readonly type: "select-column"; readonly col: number; readonly extend: boolean }
  | { readonly type: "select-row"; readonly row: number; readonly extend: boolean }
  | { readonly type: "select-cell"; readonly cell: CellAddr; readonly extend: boolean }
  | { readonly type: "extend-selection"; readonly focus: CellAddr }
  | { readonly type: "follow-link"; readonly cell: CellAddr }

export type SheetPointerTransition = { readonly state: SheetPointerState; readonly effects: readonly SheetPointerEffect[] }

export const IDLE_SHEET_POINTER_STATE: SheetPointerState = Object.freeze({ status: "idle" })

export const DISPOSED_SHEET_POINTER_STATE: SheetPointerState = Object.freeze({ status: "disposed" })

const NONE: readonly SheetPointerEffect[] = []

const IDLE: SheetPointerTransition = Object.freeze({ state: IDLE_SHEET_POINTER_STATE, effects: NONE })

const DISPOSED: SheetPointerTransition = Object.freeze({ state: DISPOSED_SHEET_POINTER_STATE, effects: NONE })

export function transitionSheetPointer(state: SheetPointerState, event: SheetPointerEvent): SheetPointerTransition {
  if (state.status === "disposed") return DISPOSED

  if (event.type === "disposed") return DISPOSED

  if (event.type === "pointer.down") return down(state, event)

  if (state.status === "idle") return IDLE

  // A second finger never moves or ends another pointer's drag.
  if (event.pointerId !== state.pointerId) return { state, effects: NONE }

  if (event.type === "pointer.cancelled") return IDLE

  if (event.type === "pointer.up")
    return state.axis === "cells" && state.pressed && event.cell && sameCell(state.pressed, event.cell)
      ? { state: IDLE_SHEET_POINTER_STATE, effects: [{ type: "follow-link", cell: event.cell }] }
      : IDLE

  // The button came up where no release reached the grid, such as over another window.
  if ((event.buttons & 1) === 0) return IDLE

  if (event.row < 0 || event.col < 0) return { state, effects: NONE }

  const next =
    state.axis === "cells" && state.pressed && (state.pressed.row !== event.row || state.pressed.col !== event.col)
      ? { ...state, pressed: undefined }
      : state
  const row = state.axis === "columns" ? 0 : event.row
  const col = state.axis === "rows" ? 0 : event.col

  if (row === event.focusRow && col === event.focusCol) return { state: next, effects: NONE }

  return { state: next, effects: [{ type: "extend-selection", focus: { row, col } }] }
}

/** Whether a drag's pointer move would change anything, so a move within one cell dispatches nothing. */
export function sheetPointerMoveNeeded(state: SheetPointerState, event: SheetPointerMoved) {
  if (state.status !== "dragging" || state.pointerId !== event.pointerId) return false

  if ((event.buttons & 1) === 0) return true

  if (event.row < 0 || event.col < 0) return false

  if (state.axis === "cells" && state.pressed && (state.pressed.row !== event.row || state.pressed.col !== event.col))
    return true

  return (
    (state.axis === "columns" ? 0 : event.row) !== event.focusRow ||
    (state.axis === "rows" ? 0 : event.col) !== event.focusCol
  )
}

function down(
  state: Extract<SheetPointerState, { status: "idle" | "dragging" }>,
  event: Extract<SheetPointerEvent, { type: "pointer.down" }>,
): SheetPointerTransition {
  const hit = event.hit

  if (event.button !== 0 || !hit || (state.status === "dragging" && state.pointerId !== event.pointerId))
    return { state, effects: NONE }

  // Selecting everything is not a drag, so the pointer is not captured.
  if (hit.kind === "all") return { state: IDLE_SHEET_POINTER_STATE, effects: [{ type: "select-all" }] }

  const capture: SheetPointerEffect = { type: "capture-pointer", pointerId: event.pointerId }

  if (hit.kind === "column")
    return {
      state: { status: "dragging", pointerId: event.pointerId, axis: "columns" },
      effects: [capture, { type: "select-column", col: hit.cell.col, extend: event.shift }],
    }

  if (hit.kind === "row")
    return {
      state: { status: "dragging", pointerId: event.pointerId, axis: "rows" },
      effects: [capture, { type: "select-row", row: hit.cell.row, extend: event.shift }],
    }

  return {
    state: {
      status: "dragging",
      pointerId: event.pointerId,
      axis: "cells",
      pressed: event.shift ? undefined : hit.cell,
    },
    effects: [capture, { type: "select-cell", cell: hit.cell, extend: event.shift }],
  }
}

function sameCell(left: CellAddr, right: CellAddr) {
  return left.row === right.row && left.col === right.col
}
