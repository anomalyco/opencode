import type { SelectedLineRange } from "@pierre/diffs"

/** How long a released selection waits unchanged before the toolbar reads it, as for the timeline's Quote. */
export const COMMENT_SELECTION_SETTLE_MS = 150

/** Space between the toolbar, the selection and the viewer's visible edges. */
export const COMMENT_SELECTION_GAP = 8

export type CommentSelectionRect = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export type CommentSelectionSize = { readonly width: number; readonly height: number }

/** The selected text's box in viewport pixels. `start` is its first glyph's left edge, `end` its last glyph's right. */
export type CommentSelectionAnchor = {
  readonly top: number
  readonly bottom: number
  readonly start: number
  readonly end: number
  readonly single: boolean
  /** Dragged upwards, so the pointer rests at the start. */
  readonly backward: boolean
}

/** The viewer's text selection, read in one frame. `anchor` is undefined while it is scrolled out of `bounds`. */
export type CommentSelectionSample = {
  readonly range: SelectedLineRange
  /** The part of the viewer that is on screen. */
  readonly bounds: CommentSelectionRect
  readonly anchor: CommentSelectionAnchor | undefined
}

/**
 * The Add comment toolbar for text selected in a file or diff viewer. `pressing` is a primary press inside the viewer;
 * its selection is read only after the release, once it has stayed unchanged for `COMMENT_SELECTION_SETTLE_MS` under
 * `attempt`. `shown` offers a comment on `range`; `placeAttempt` names the queued placement frame.
 */
export type CommentSelectionState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "pressing"; readonly issued: number }
  | { readonly status: "settling"; readonly issued: number; readonly attempt: number }
  | {
      readonly status: "shown"
      readonly issued: number
      readonly range: SelectedLineRange
      readonly bounds: CommentSelectionRect
      readonly anchor: CommentSelectionAnchor | undefined
      /** Zero until the toolbar is measured. */
      readonly size: CommentSelectionSize
      readonly placeAttempt: number | undefined
    }
  | { readonly status: "disposed" }

export type CommentSelectionEvent =
  /** A press outside the toolbar; `inside` when it landed in this viewer. */
  | { readonly type: "pointer.down"; readonly button: number; readonly inside: boolean }
  /** `pointerup`, `pointercancel`, `contextmenu` or window `blur`: the press ended. */
  | { readonly type: "pointer.released" }
  | { readonly type: "selection.changed" }
  /** `sample` is undefined when nothing in this viewer is selected. */
  | { readonly type: "settle.sampled"; readonly attempt: number; readonly sample: CommentSelectionSample | undefined }
  /** Something scrolled or resized. */
  | { readonly type: "layout.changed" }
  | { readonly type: "place.sampled"; readonly attempt: number; readonly sample: CommentSelectionSample | undefined }
  | { readonly type: "toolbar.measured"; readonly size: CommentSelectionSize }
  | { readonly type: "escape" }
  | { readonly type: "comment.added" }
  | { readonly type: "disposed" }

export type CommentSelectionEffect =
  | { readonly type: "schedule-settle"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-settle" }
  | { readonly type: "schedule-place"; readonly attempt: number }
  | { readonly type: "cancel-place" }
  | { readonly type: "clear-selection" }
  | { readonly type: "open-draft"; readonly range: SelectedLineRange }

export type CommentSelectionTransition = {
  readonly state: CommentSelectionState
  readonly effects: readonly CommentSelectionEffect[]
}

type Active = Exclude<CommentSelectionState, { status: "disposed" }>

const NONE: readonly never[] = []

const CANCEL_SETTLE: readonly CommentSelectionEffect[] = [{ type: "cancel-settle" }]

const CANCEL_PLACE: readonly CommentSelectionEffect[] = [{ type: "cancel-place" }]

const UNMEASURED: CommentSelectionSize = { width: 0, height: 0 }

export function createCommentSelectionState(): CommentSelectionState {
  return { status: "idle", issued: 0 }
}

export function transitionCommentSelection(
  state: CommentSelectionState,
  event: CommentSelectionEvent,
): CommentSelectionTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cancel(state) }

  if (event.type === "pointer.down") {
    if (event.button !== 0) return { state, effects: NONE }

    // A press elsewhere closes the toolbar; one in the viewer starts a selection that the release reads.
    const status = event.inside ? "pressing" : "idle"

    if (state.status === status) return { state, effects: NONE }

    return { state: { status, issued: state.issued }, effects: cancel(state) }
  }

  if (event.type === "pointer.released") {
    if (state.status !== "pressing") return { state, effects: NONE }

    return settle(state, NONE)
  }

  if (event.type === "selection.changed") {
    // A drag is read on release, and a selection made elsewhere is not this viewer's.
    if (state.status !== "shown" && state.status !== "settling") return { state, effects: NONE }

    return settle(state, cancel(state))
  }

  if (event.type === "settle.sampled") {
    if (state.status !== "settling" || state.attempt !== event.attempt) return { state, effects: NONE }

    if (!event.sample) return { state: { status: "idle", issued: state.issued }, effects: NONE }

    return {
      state: {
        status: "shown",
        issued: state.issued,
        range: event.sample.range,
        bounds: event.sample.bounds,
        anchor: event.sample.anchor,
        size: UNMEASURED,
        placeAttempt: undefined,
      },
      effects: NONE,
    }
  }

  if (event.type === "escape") {
    if (state.status !== "shown" && state.status !== "settling") return { state, effects: NONE }

    return { state: { status: "idle", issued: state.issued }, effects: cancel(state) }
  }

  if (state.status !== "shown") return { state, effects: NONE }

  if (event.type === "layout.changed") {
    // One frame places the toolbar for every scroll and resize before it.
    if (state.placeAttempt !== undefined) return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, placeAttempt: attempt },
      effects: [{ type: "schedule-place", attempt }],
    }
  }

  if (event.type === "place.sampled") {
    if (state.placeAttempt !== event.attempt) return { state, effects: NONE }

    // The selected rows left the viewer, such as when a virtualized diff dropped them.
    if (!event.sample) return { state: { status: "idle", issued: state.issued }, effects: NONE }

    return {
      state: { ...state, bounds: event.sample.bounds, anchor: event.sample.anchor, placeAttempt: undefined },
      effects: NONE,
    }
  }

  if (event.type === "toolbar.measured") {
    if (event.size.width === state.size.width && event.size.height === state.size.height)
      return { state, effects: NONE }

    return { state: { ...state, size: event.size }, effects: NONE }
  }

  return {
    state: { status: "idle", issued: state.issued },
    effects: [...cancel(state), { type: "clear-selection" }, { type: "open-draft", range: state.range }],
  }
}

/**
 * The toolbar's position, or undefined while it is closed or its selection is out of view. `docked` is for touch
 * screens, which show their own menu over the selection.
 */
export function selectCommentSelectionToolbar(state: CommentSelectionState, docked = false) {
  if (state.status !== "shown" || !state.anchor) return

  return {
    place: commentSelectionPosition(state.size, state.bounds, state.anchor, docked),
    measured: state.size.height !== 0,
  }
}

/**
 * Like the terminal's Quote: a one-line selection gets the toolbar centered above it, a taller one gets it beside the
 * end the pointer stopped at, below a downward drag and above an upward one.
 */
export function commentSelectionPosition(
  size: CommentSelectionSize,
  bounds: CommentSelectionRect,
  anchor: CommentSelectionAnchor,
  docked: boolean,
) {
  const gap = COMMENT_SELECTION_GAP
  const pinned = bounds.bottom - size.height - gap

  if (docked) return { top: pinned, left: (bounds.left + bounds.right - size.width) / 2 }
  const above = anchor.top - size.height - gap
  const below = anchor.bottom + gap
  const fitsAbove = above >= bounds.top + gap && anchor.top <= bounds.bottom
  const fitsBelow = below + size.height <= bounds.bottom - gap && anchor.bottom >= bounds.top
  const prefersAbove = anchor.single || anchor.backward
  const sides = prefersAbove ? [fitsAbove && above, fitsBelow && below] : [fitsBelow && below, fitsAbove && above]
  const top = sides.find((side) => side !== false)

  const center = anchor.single
    ? (anchor.start + anchor.end - size.width) / 2
    : (anchor.backward ? anchor.start : anchor.end) - size.width / 2

  return {
    top: top ?? pinned,
    // A viewer narrower than the toolbar pins it to the left edge instead of past it.
    left: Math.max(bounds.left + gap, Math.min(center, bounds.right - size.width - gap)),
  }
}

function settle(state: Active, effects: readonly CommentSelectionEffect[]): CommentSelectionTransition {
  const attempt = state.issued + 1

  return {
    state: { status: "settling", issued: attempt, attempt },
    effects: [...effects, { type: "schedule-settle", attempt, delayMs: COMMENT_SELECTION_SETTLE_MS }],
  }
}

function cancel(state: Active): readonly CommentSelectionEffect[] {
  if (state.status === "settling") return CANCEL_SETTLE

  if (state.status === "shown" && state.placeAttempt !== undefined) return CANCEL_PLACE

  return NONE
}
