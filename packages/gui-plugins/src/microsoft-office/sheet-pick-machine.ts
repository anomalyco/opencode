import type { CellAddr } from "@betteroffice/xlsx/headless"
import type { SheetLayout } from "./sheet-protocol"

/** How long a sheet may take to open in the worker, its wait behind other workbook calls included. */
export const SHEET_SHOW_TIMEOUT_MS = 30_000

/** The sheet on show, and the cell a link asked for when one opened it. */
export type SheetShown = { readonly layout: SheetLayout; readonly target: CellAddr | undefined }

/**
 * A workbook's sheet tabs. Each pick of another sheet takes the next attempt number, and only the newest attempt's
 * reply changes the sheet on show.
 */
export type SheetPickState =
  /** The picked tab is the sheet on show. */
  | { readonly status: "showing"; readonly issued: number; readonly shown: SheetShown }
  /** The user picked `selecting`, which opens in the worker while the sheet on show stays. */
  | {
      readonly status: "selecting"
      readonly attempt: number
      readonly selecting: number
      readonly target: CellAddr | undefined
      readonly shown: SheetShown
    }
  | { readonly status: "disposed" }

export type SheetPickEvent =
  /** A tab click, an arrow key, or a link to another sheet with the cell it reveals. */
  | { readonly type: "sheet.picked"; readonly sheet: number; readonly target: CellAddr | undefined }
  | { readonly type: "show.succeeded"; readonly attempt: number; readonly layout: SheetLayout }
  /** `closed` when the worker stopped or the call was withdrawn; the viewer reports a stopped worker itself. */
  | { readonly type: "show.failed"; readonly attempt: number; readonly closed: boolean }
  | { readonly type: "show.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SheetPickEffect =
  | { readonly type: "request-show"; readonly attempt: number; readonly sheet: number; readonly timeoutMs: number }
  | { readonly type: "abort-show"; readonly attempt: number }
  | { readonly type: "notify-open-failed" }

export type SheetPickTransition = { readonly state: SheetPickState; readonly effects: readonly SheetPickEffect[] }

export const DISPOSED_SHEET_PICK_STATE: SheetPickState = Object.freeze({ status: "disposed" })

const NONE: readonly SheetPickEffect[] = []

const NOTIFY: readonly SheetPickEffect[] = [{ type: "notify-open-failed" }]

export function createSheetPickState(layout: SheetLayout): SheetPickState {
  return { status: "showing", issued: 0, shown: { layout, target: undefined } }
}

export function transitionSheetPick(state: SheetPickState, event: SheetPickEvent): SheetPickTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return {
      state: DISPOSED_SHEET_PICK_STATE,
      effects: state.status === "selecting" ? [{ type: "abort-show", attempt: state.attempt }] : NONE,
    }

  if (event.type === "sheet.picked") return picked(state, event)

  // A reply to a pick that a newer pick or a return to the sheet on show withdrew changes nothing.
  if (state.status !== "selecting" || event.attempt !== state.attempt) return { state, effects: NONE }

  if (event.type === "show.succeeded")
    return {
      state: { status: "showing", issued: state.attempt, shown: { layout: event.layout, target: state.target } },
      effects: NONE,
    }

  // One sheet that fails to open leaves the others readable: the sheet on show stays.
  const back: SheetPickState = { status: "showing", issued: state.attempt, shown: state.shown }

  if (event.type === "show.failed") return { state: back, effects: event.closed ? NONE : NOTIFY }

  return { state: back, effects: [{ type: "abort-show", attempt: state.attempt }, ...NOTIFY] }
}

/** The sheet on show; a new object only when another sheet opened or a link asked for a cell on it. */
export function sheetShown(state: SheetPickState) {
  return state.status === "disposed" ? undefined : state.shown
}

/** The index of the sheet on show. */
export function sheetShownIndex(state: SheetPickState) {
  return sheetShown(state)?.layout.info.activeSheet
}

/** The tab that shows selected: the one opening, else the sheet on show. */
export function sheetActiveTab(state: SheetPickState) {
  return state.status === "selecting" ? state.selecting : sheetShownIndex(state)
}

function picked(
  state: Extract<SheetPickState, { status: "showing" | "selecting" }>,
  event: Extract<SheetPickEvent, { type: "sheet.picked" }>,
): SheetPickTransition {
  const target = event.target

  // The sheet already opening: a link's cell rides along with the call that runs.
  if (state.status === "selecting" && event.sheet === state.selecting) {
    if (!target || sameCell(state.target, target)) return { state, effects: NONE }

    return { state: { ...state, target }, effects: NONE }
  }

  // Back to the sheet on show: the pick that was opening is withdrawn, and the grid stays unless a link asks for a cell.
  if (event.sheet === state.shown.layout.info.activeSheet) {
    const shown = target ? { layout: state.shown.layout, target } : state.shown

    if (state.status === "showing") return { state: target ? { ...state, shown } : state, effects: NONE }

    return {
      state: { status: "showing", issued: state.attempt, shown },
      effects: [{ type: "abort-show", attempt: state.attempt }],
    }
  }

  const attempt = (state.status === "selecting" ? state.attempt : state.issued) + 1
  const request: SheetPickEffect = { type: "request-show", attempt, sheet: event.sheet, timeoutMs: SHEET_SHOW_TIMEOUT_MS }

  return {
    state: { status: "selecting", attempt, selecting: event.sheet, target, shown: state.shown },
    effects: state.status === "selecting" ? [{ type: "abort-show", attempt: state.attempt }, request] : [request],
  }
}

function sameCell(left: CellAddr | undefined, right: CellAddr) {
  return !!left && left.row === right.row && left.col === right.col
}
