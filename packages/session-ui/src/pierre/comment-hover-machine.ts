export type HoverCommentSide = "additions" | "deletions"

export type HoverCommentLine = {
  readonly lineNumber: number
  readonly side?: HoverCommentSide
}

/**
 * One gutter comment `+` button. Runs on every pointer move and scroll, so it returns the same object when nothing
 * changes and reads its events from one reused object.
 * - `tracking`: listens to the document and caches the last hovered line, so a click still has one after the pointer
 *   leaves the code. Leaving the document does not end it: Pierre inserts the button after creating it, and may detach
 *   and reattach the viewer.
 * - `disposed`: its owner replaced or unmounted it; the document listeners are gone.
 */
export type HoverCommentState =
  | { readonly status: "tracking"; readonly line: HoverCommentLine | undefined }
  | { readonly status: "disposed" }

export type HoverCommentEvent =
  | {
      readonly type: "hover.synced"
      readonly lineNumber: number | undefined
      readonly side: HoverCommentSide | undefined
    }
  | { readonly type: "disposed" }

export const INITIAL_HOVER_COMMENT_STATE: HoverCommentState = Object.freeze({ status: "tracking", line: undefined })

export const DISPOSED_HOVER_COMMENT_STATE: HoverCommentState = Object.freeze({ status: "disposed" })

export function transitionHoverComment(state: HoverCommentState, event: HoverCommentEvent): HoverCommentState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_HOVER_COMMENT_STATE
  const lineNumber = event.lineNumber

  // No hovered line (the pointer left the code) keeps the cached one.
  if (lineNumber === undefined || (lineNumber === state.line?.lineNumber && event.side === state.line?.side))
    return state

  return { status: "tracking", line: { lineNumber, side: event.side } }
}

/** Whether the button still listens to the document, and so whether a render may hand it back again. */
export function selectHoverActive(state: HoverCommentState) {
  return state.status !== "disposed"
}

export function selectHoverLine(state: HoverCommentState) {
  return state.status === "disposed" ? undefined : state.line
}
