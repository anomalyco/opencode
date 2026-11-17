import type { SelectedLineRange } from "@pierre/diffs"
import type { DiffSelectionSide } from "./diff-selection"
import { isSingleLineSelection } from "./selection-bridge"

/** `text` orders a dragged range top to bottom; `diff` keeps its direction and the side of each end. */
export type FileSelectionMode = "text" | "diff"

export type SelectionPoint = {
  readonly line: number
  readonly side?: DiffSelectionSide
}

type Shared = {
  readonly mode: FileSelectionMode
  /** The range the viewer shows; the render driver reapplies it once fresh rows exist. */
  readonly selected: SelectedLineRange | null
  /** Gesture count. A frame scheduled for an earlier gesture is stale. */
  readonly attempt: number
}

/**
 * One line-selection gesture in a file or diff viewer. A press on the code (`text` column) selects lines from our own
 * mouse handlers: a click toggles one line, a drag selects the lines between its ends, and `finishing` waits one frame
 * for the browser's text selection before it commits. A press on the line numbers (`numbers` column) belongs to Pierre;
 * the machine only tracks whether it moved, so a multi-line number drag can report itself.
 */
export type FileSelectionState =
  | (Shared & { readonly status: "idle" })
  | (Shared & { readonly status: "pressing"; readonly column: "text"; readonly origin: SelectionPoint })
  | (Shared & { readonly status: "pressing"; readonly column: "numbers"; readonly originLine: number | undefined })
  | (Shared & {
      readonly status: "dragging"
      readonly column: "text"
      readonly origin: SelectionPoint
      readonly current: SelectionPoint
    })
  | (Shared & { readonly status: "dragging"; readonly column: "numbers" })
  | (Shared & { readonly status: "finishing"; readonly range: SelectedLineRange })
  | { readonly status: "disposed" }

export type FileSelectionEvent =
  | {
      readonly type: "pointer.down"
      readonly button: number
      readonly column: "text" | "numbers"
      readonly line: number | undefined
      readonly side: DiffSelectionSide | undefined
    }
  | {
      readonly type: "pointer.move"
      readonly buttons: number
      readonly line: number | undefined
      readonly side: DiffSelectionSide | undefined
    }
  | { readonly type: "pointer.up" }
  /** The browser selection inside the viewer is no longer collapsed. */
  | { readonly type: "selection.changed" }
  | { readonly type: "drag.frame"; readonly attempt: number }
  | { readonly type: "selection.frame"; readonly attempt: number; readonly range: SelectedLineRange }
  /** `range` is the browser's text selection, or `undefined` when it is collapsed (a drag over whitespace). */
  | { readonly type: "finish.frame"; readonly attempt: number; readonly range: SelectedLineRange | undefined }
  | { readonly type: "pierre.line-selected"; readonly range: SelectedLineRange | null }
  | { readonly type: "pierre.selection-ended"; readonly range: SelectedLineRange | null }
  | { readonly type: "selection.controlled"; readonly range: SelectedLineRange | null }
  | { readonly type: "selection.disabled" }
  | { readonly type: "disposed" }

export type FileSelectionEffect =
  | { readonly type: "cancel-frames" }
  | { readonly type: "schedule-drag"; readonly attempt: number }
  | { readonly type: "schedule-selection"; readonly attempt: number }
  | { readonly type: "schedule-finish"; readonly attempt: number }
  /** `preserveText` restores the browser's text selection after Pierre redraws the selected rows. */
  | { readonly type: "apply-selection"; readonly range: SelectedLineRange | null; readonly preserveText: boolean }
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

const CANCEL_FRAMES: readonly FileSelectionEffect[] = Object.freeze([Object.freeze({ type: "cancel-frames" as const })])

export function createFileSelectionState(mode: FileSelectionMode): FileSelectionState {
  return { status: "idle", mode, selected: null, attempt: 0 }
}

export function transitionFileSelection(state: FileSelectionState, event: FileSelectionEvent): FileSelectionTransition {
  if (state.status === "disposed") return { state, effects: NO_SELECTION_EFFECTS }

  if (event.type === "disposed")
    return { state: DISPOSED_FILE_SELECTION_STATE, effects: framed(state) ? CANCEL_FRAMES : NO_SELECTION_EFFECTS }

  if (event.type === "selection.disabled") {
    if (state.status === "idle") return { state, effects: NO_SELECTION_EFFECTS }

    return { state: idle(state, state.selected, state.attempt + 1), effects: CANCEL_FRAMES }
  }

  if (event.type === "pointer.down") return press(state, event)

  if (event.type === "pointer.move") return move(state, event)

  if (event.type === "pointer.up") return release(state)

  if (event.type === "selection.changed") {
    if (state.status === "pressing" && state.column === "text")
      return {
        state: { ...shared(state), status: "dragging", column: "text", origin: state.origin, current: state.origin },
        effects: [{ type: "schedule-selection", attempt: state.attempt }],
      }

    if (state.status === "dragging" && state.column === "text")
      return { state, effects: [{ type: "schedule-selection", attempt: state.attempt }] }

    return { state, effects: NO_SELECTION_EFFECTS }
  }

  if (event.type === "drag.frame") {
    if (state.status !== "dragging" || state.column !== "text" || event.attempt !== state.attempt)
      return { state, effects: NO_SELECTION_EFFECTS }
    const range = buildSelectionRange(state.mode, state.origin, state.current)

    return { state: { ...state, selected: range }, effects: [{ type: "apply-selection", range, preserveText: false }] }
  }

  if (event.type === "selection.frame") {
    if (state.status !== "dragging" || state.column !== "text" || event.attempt !== state.attempt)
      return { state, effects: NO_SELECTION_EFFECTS }

    return {
      state: { ...state, selected: event.range },
      effects: [{ type: "apply-selection", range: event.range, preserveText: false }],
    }
  }

  if (event.type === "finish.frame") {
    if (state.status !== "finishing" || event.attempt !== state.attempt) return { state, effects: NO_SELECTION_EFFECTS }
    const range = event.range ?? state.range

    return {
      state: idle(state, range, state.attempt),
      effects: [
        { type: "apply-selection", range, preserveText: event.range !== undefined },
        { type: "notify-selection-end", range, fromNumberDrag: false },
      ],
    }
  }

  if (event.type === "pierre.line-selected")
    return {
      state: state.selected === event.range ? state : { ...state, selected: event.range },
      effects: [{ type: "notify-line-selected", range: event.range }],
    }

  if (event.type === "pierre.selection-ended") {
    const fromNumberDrag =
      state.status === "dragging" && state.column === "numbers" && !isSingleLineSelection(event.range)

    return {
      state: idle(state, event.range, state.attempt + 1),
      effects: [
        ...(framed(state) ? CANCEL_FRAMES : NO_SELECTION_EFFECTS),
        { type: "notify-selection-end", range: event.range, fromNumberDrag },
      ],
    }
  }

  if (state.selected === event.range) return { state, effects: NO_SELECTION_EFFECTS }

  return {
    state: { ...state, selected: event.range },
    effects: [{ type: "apply-selection", range: event.range, preserveText: false }],
  }
}

function press(state: Active, event: Extract<FileSelectionEvent, { type: "pointer.down" }>): FileSelectionTransition {
  if (event.button !== 0) return { state, effects: NO_SELECTION_EFFECTS }
  const effects = framed(state) ? CANCEL_FRAMES : NO_SELECTION_EFFECTS

  if (event.column === "numbers")
    return {
      state: {
        ...shared(state),
        attempt: state.attempt + 1,
        status: "pressing",
        column: "numbers",
        originLine: event.line,
      },
      effects,
    }

  if (event.line === undefined) return { state, effects: NO_SELECTION_EFFECTS }

  return {
    state: {
      ...shared(state),
      attempt: state.attempt + 1,
      status: "pressing",
      column: "text",
      origin: { line: event.line, side: event.side },
    },
    effects,
  }
}

function move(state: Active, event: Extract<FileSelectionEvent, { type: "pointer.move" }>): FileSelectionTransition {
  if (state.status !== "pressing" && state.status !== "dragging") return { state, effects: NO_SELECTION_EFFECTS }

  // The button came up outside the window, so no mouseup reached us.
  if ((event.buttons & 1) === 0)
    return {
      state: idle(state, state.selected, state.attempt + 1),
      effects: framed(state) ? CANCEL_FRAMES : NO_SELECTION_EFFECTS,
    }

  if (event.line === undefined) return { state, effects: NO_SELECTION_EFFECTS }

  if (state.column === "numbers") {
    if (state.status === "dragging" || state.originLine === undefined || event.line === state.originLine)
      return { state, effects: NO_SELECTION_EFFECTS }

    return { state: { ...shared(state), status: "dragging", column: "numbers" }, effects: NO_SELECTION_EFFECTS }
  }

  const last = state.status === "dragging" ? state.current : state.origin

  if (event.line === last.line && event.side === last.side) return { state, effects: NO_SELECTION_EFFECTS }

  return {
    state: {
      ...shared(state),
      status: "dragging",
      column: "text",
      origin: state.origin,
      current: { line: event.line, side: event.side },
    },
    effects: [{ type: "schedule-drag", attempt: state.attempt }],
  }
}

function release(state: Active): FileSelectionTransition {
  if (state.status !== "pressing" && state.status !== "dragging") return { state, effects: NO_SELECTION_EFFECTS }

  // Pierre ends a line-number gesture on its own pointerup, which runs before this mouseup.
  if (state.column === "numbers")
    return { state: idle(state, state.selected, state.attempt + 1), effects: NO_SELECTION_EFFECTS }

  if (state.status === "dragging") {
    const attempt = state.attempt + 1

    return {
      state: {
        ...shared(state),
        attempt,
        status: "finishing",
        range: buildSelectionRange(state.mode, state.origin, state.current),
      },
      effects: [{ type: "cancel-frames" }, { type: "schedule-finish", attempt }],
    }
  }

  const click = buildSelectionRange(state.mode, state.origin, state.origin)
  const range = sameSelectedRange(state.selected, click) ? null : click

  return {
    state: idle(state, range, state.attempt + 1),
    effects: [
      { type: "apply-selection", range, preserveText: false },
      { type: "notify-selection-end", range, fromNumberDrag: false },
    ],
  }
}

function shared(state: Active) {
  return { mode: state.mode, selected: state.selected, attempt: state.attempt }
}

function idle(state: Active, selected: SelectedLineRange | null, attempt: number): FileSelectionState {
  return { status: "idle", mode: state.mode, selected, attempt }
}

/** Whether a drag, selection or finish frame may be queued. */
function framed(state: Active) {
  return (state.status === "dragging" && state.column === "text") || state.status === "finishing"
}

export function selectSelectedRange(state: FileSelectionState) {
  return state.status === "disposed" ? null : state.selected
}

/** Whether pointer moves can change the gesture; checked before any hit testing. */
export function selectPointerTracking(state: FileSelectionState) {
  return state.status === "pressing" || state.status === "dragging"
}

/** Whether a browser text selection can extend the gesture. */
export function selectTextSelectionTracking(state: FileSelectionState) {
  return (state.status === "pressing" || state.status === "dragging") && state.column === "text"
}

export function buildSelectionRange(
  mode: FileSelectionMode,
  origin: SelectionPoint,
  current: SelectionPoint,
): SelectedLineRange {
  if (mode === "text") return { start: Math.min(origin.line, current.line), end: Math.max(origin.line, current.line) }
  const range: SelectedLineRange = { start: origin.line, end: current.line }

  if (origin.side) range.side = origin.side

  if (origin.side && current.side && current.side !== origin.side) range.endSide = current.side

  return range
}

export function sameSelectedRange(a: SelectedLineRange | null, b: SelectedLineRange | null) {
  if (!a || !b) return a === b

  return a.start === b.start && a.end === b.end && a.side === b.side && (a.endSide ?? a.side) === (b.endSide ?? b.side)
}
