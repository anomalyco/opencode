import type { SelectedLineRange } from "@pierre/diffs"
import type { DiffSelectionSide } from "./diff-selection"
import { isSingleLineSelection } from "./selection-bridge"

type Shared = {
  /** The range the viewer shows; the render driver reapplies it once fresh rows exist. */
  readonly selected: SelectedLineRange | null
  /** Gesture count. */
  readonly attempt: number
}

/**
 * Line selection in a file or diff viewer. Line numbers select lines: Pierre runs that gesture, and the machine only
 * tracks whether it moved, so a multi-line number drag can report itself. A mouse press on the code is left to the
 * browser's text selection, which the viewer offers to comment on separately. A tap on the code toggles its line,
 * because touch selects text with a long press instead, and narrow diffs hide their line numbers.
 */
export type FileSelectionState =
  | (Shared & { readonly status: "idle" })
  | (Shared & { readonly status: "pressing"; readonly originLine: number | undefined })
  | (Shared & { readonly status: "dragging" })
  | (Shared & { readonly status: "tapping"; readonly line: number; readonly side: DiffSelectionSide | undefined })
  | { readonly status: "disposed" }

export type FileSelectionEvent =
  | {
      readonly type: "pointer.down"
      readonly button: number
      readonly column: "text" | "numbers"
      readonly line: number | undefined
      readonly side: DiffSelectionSide | undefined
      readonly touch: boolean
    }
  | { readonly type: "pointer.move"; readonly buttons: number; readonly line: number | undefined }
  | { readonly type: "pointer.up" }
  /** The browser took the touch over, to scroll or to select text. */
  | { readonly type: "pointer.cancelled" }
  | { readonly type: "pierre.line-selected"; readonly range: SelectedLineRange | null }
  | { readonly type: "pierre.selection-ended"; readonly range: SelectedLineRange | null }
  | { readonly type: "selection.controlled"; readonly range: SelectedLineRange | null }
  | { readonly type: "selection.disabled" }
  | { readonly type: "disposed" }

export type FileSelectionEffect =
  | { readonly type: "apply-selection"; readonly range: SelectedLineRange | null }
  | { readonly type: "notify-line-selected"; readonly range: SelectedLineRange | null }
  | {
      readonly type: "notify-selection-end"
      readonly range: SelectedLineRange | null
      readonly fromNumberDrag: boolean
    }

export type FileSelectionTransition = {
  readonly state: FileSelectionState
  readonly effects: readonly FileSelectionEffect[]
}

type Active = Exclude<FileSelectionState, { status: "disposed" }>

export const NO_SELECTION_EFFECTS: readonly FileSelectionEffect[] = Object.freeze([])

export const DISPOSED_FILE_SELECTION_STATE: FileSelectionState = Object.freeze({ status: "disposed" })

export function createFileSelectionState(): FileSelectionState {
  return { status: "idle", selected: null, attempt: 0 }
}

export function transitionFileSelection(state: FileSelectionState, event: FileSelectionEvent): FileSelectionTransition {
  if (state.status === "disposed") return { state, effects: NO_SELECTION_EFFECTS }

  if (event.type === "disposed") return { state: DISPOSED_FILE_SELECTION_STATE, effects: NO_SELECTION_EFFECTS }

  if (event.type === "selection.disabled") {
    if (state.status === "idle") return { state, effects: NO_SELECTION_EFFECTS }

    return { state: idle(state, state.selected, state.attempt + 1), effects: NO_SELECTION_EFFECTS }
  }

  if (event.type === "pointer.down") {
    if (event.button !== 0) return { state, effects: NO_SELECTION_EFFECTS }

    if (event.column === "text") {
      if (!event.touch || event.line === undefined) return { state, effects: NO_SELECTION_EFFECTS }

      return {
        state: {
          status: "tapping",
          selected: state.selected,
          attempt: state.attempt + 1,
          line: event.line,
          side: event.side,
        },
        effects: NO_SELECTION_EFFECTS,
      }
    }

    return {
      state: { status: "pressing", selected: state.selected, attempt: state.attempt + 1, originLine: event.line },
      effects: NO_SELECTION_EFFECTS,
    }
  }

  if (event.type === "pointer.cancelled") {
    if (!selectPointerTracking(state)) return { state, effects: NO_SELECTION_EFFECTS }

    return { state: idle(state, state.selected, state.attempt + 1), effects: NO_SELECTION_EFFECTS }
  }

  if (event.type === "pointer.move") {
    if (state.status === "tapping") {
      if (event.line === undefined || event.line === state.line) return { state, effects: NO_SELECTION_EFFECTS }

      return { state: idle(state, state.selected, state.attempt + 1), effects: NO_SELECTION_EFFECTS }
    }

    if (state.status !== "pressing" && state.status !== "dragging") return { state, effects: NO_SELECTION_EFFECTS }

    // The button came up outside the window, so no mouseup reached us.
    if ((event.buttons & 1) === 0)
      return { state: idle(state, state.selected, state.attempt + 1), effects: NO_SELECTION_EFFECTS }

    if (
      state.status === "dragging" ||
      event.line === undefined ||
      state.originLine === undefined ||
      event.line === state.originLine
    )
      return { state, effects: NO_SELECTION_EFFECTS }

    return {
      state: { status: "dragging", selected: state.selected, attempt: state.attempt },
      effects: NO_SELECTION_EFFECTS,
    }
  }

  if (event.type === "pointer.up" && state.status === "tapping") {
    const line: SelectedLineRange = { start: state.line, end: state.line }

    if (state.side) line.side = state.side

    const range =
      state.selected && isSingleLineSelection(state.selected) && sameLine(state.selected, line) ? null : line

    return {
      state: idle(state, range, state.attempt),
      effects: [
        { type: "apply-selection", range },
        { type: "notify-selection-end", range, fromNumberDrag: false },
      ],
    }
  }

  // Pierre ends a line-number gesture on its own pointerup, which runs before this one.
  if (event.type === "pointer.up") {
    if (state.status !== "pressing" && state.status !== "dragging") return { state, effects: NO_SELECTION_EFFECTS }

    return { state: idle(state, state.selected, state.attempt + 1), effects: NO_SELECTION_EFFECTS }
  }

  if (event.type === "pierre.line-selected")
    return {
      state: state.selected === event.range ? state : { ...state, selected: event.range },
      effects: [{ type: "notify-line-selected", range: event.range }],
    }

  if (event.type === "pierre.selection-ended") {
    const fromNumberDrag = state.status === "dragging" && !isSingleLineSelection(event.range)

    return {
      state: idle(state, event.range, state.attempt + 1),
      effects: [{ type: "notify-selection-end", range: event.range, fromNumberDrag }],
    }
  }

  if (state.selected === event.range) return { state, effects: NO_SELECTION_EFFECTS }

  return {
    state: { ...state, selected: event.range },
    effects: [{ type: "apply-selection", range: event.range }],
  }
}

function idle(state: Active, selected: SelectedLineRange | null, attempt: number): FileSelectionState {
  return { status: "idle", selected, attempt }
}

export function selectSelectedRange(state: FileSelectionState) {
  return state.status === "disposed" ? null : state.selected
}

/** Whether pointer moves can change the gesture; checked before any hit testing. */
export function selectPointerTracking(state: FileSelectionState) {
  return state.status === "pressing" || state.status === "dragging" || state.status === "tapping"
}

function sameLine(a: SelectedLineRange, b: SelectedLineRange) {
  return a.start === b.start && a.side === b.side
}
