// An unanswered request stops waiting for its view, so a panel opened minutes later does not jump to an old comment.
export const COMMENT_FOCUS_TIMEOUT_MS = 5_000

export type CommentTarget = {
  readonly file: string
  readonly id: string
}

/**
 * A session's comment focus handoff and its active comment.
 * - `idle`: no view has a comment to reveal; `active` still marks the last opened comment.
 * - `pending`: the view that shows `target` (the review diff or a file tab) reveals it and acknowledges with
 *   `focus.set(null)`, or the request times out.
 * - `disposed`: the session's comment state was evicted; late acknowledgements and timers are ignored.
 */
export type CommentFocusState =
  | { readonly status: "idle"; readonly attempt: number; readonly active: CommentTarget | null }
  | {
      readonly status: "pending"
      readonly attempt: number
      readonly target: CommentTarget
      readonly active: CommentTarget | null
    }
  | { readonly status: "disposed" }

export type CommentFocusEvent =
  /** A view or a new comment asks for `target` to be revealed; `null` is a view's acknowledgement. */
  | { readonly type: "focus.set"; readonly target: CommentTarget | null }
  /** The user opened a comment from its composer chip: reveal it and mark it active. */
  | { readonly type: "comment.opened"; readonly target: CommentTarget }
  | { readonly type: "active.set"; readonly target: CommentTarget | null }
  | { readonly type: "comment.removed"; readonly target: CommentTarget }
  | { readonly type: "comments.reset" }
  | { readonly type: "focus.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type CommentFocusEffect =
  | { readonly type: "timer.start"; readonly attempt: number }
  | { readonly type: "timer.clear" }

export type CommentFocusTransition = {
  readonly state: CommentFocusState
  readonly effects: readonly CommentFocusEffect[]
}

export const INITIAL_COMMENT_FOCUS_STATE: CommentFocusState = Object.freeze({
  status: "idle",
  attempt: 0,
  active: null,
})

const NO_EFFECTS: readonly CommentFocusEffect[] = Object.freeze([])

const CLEAR_TIMER: readonly CommentFocusEffect[] = Object.freeze([{ type: "timer.clear" }])

export function transitionCommentFocus(state: CommentFocusState, event: CommentFocusEvent): CommentFocusTransition {
  if (state.status === "disposed") return stay(state)

  switch (event.type) {
    case "disposed":
      return { state: { status: "disposed" }, effects: state.status === "pending" ? CLEAR_TIMER : NO_EFFECTS }
    case "focus.set":
      if (!event.target) return settle(state, state.active)

      if (state.status === "pending" && sameTarget(state.target, event.target)) return stay(state)

      return request(state, event.target, state.active)
    case "comment.opened":
      if (state.status === "pending" && sameTarget(state.target, event.target)) {
        if (sameTarget(state.active, event.target)) return stay(state)

        return { state: { ...state, active: state.target }, effects: NO_EFFECTS }
      }

      return request(state, event.target, copy(event.target))
    case "active.set":
      if (sameTarget(state.active, event.target)) return stay(state)

      return { state: { ...state, active: event.target && copy(event.target) }, effects: NO_EFFECTS }
    case "comment.removed":
      if (state.status !== "pending" || !sameTarget(state.target, event.target)) return stay(state)

      return settle(state, state.active)
    case "comments.reset":
      if (state.status === "idle" && !state.active) return stay(state)

      return settle(state, null)
    case "focus.timed-out":
      if (state.status !== "pending" || state.attempt !== event.attempt) return stay(state)

      return settle(state, state.active)
  }
}

/** The comment a view should reveal now, or `null`. */
export function commentFocusTarget(state: CommentFocusState) {
  return state.status === "pending" ? state.target : null
}

/** The comment the composer marks as opened, or `null`. */
export function commentActiveTarget(state: CommentFocusState) {
  return state.status === "disposed" ? null : state.active
}

function request(
  state: Exclude<CommentFocusState, { status: "disposed" }>,
  target: CommentTarget,
  active: CommentTarget | null,
): CommentFocusTransition {
  const attempt = state.attempt + 1

  return {
    state: { status: "pending", attempt, target: copy(target), active },
    effects: [{ type: "timer.start", attempt }],
  }
}

function settle(
  state: Exclude<CommentFocusState, { status: "disposed" }>,
  active: CommentTarget | null,
): CommentFocusTransition {
  if (state.status === "idle" && state.active === active) return stay(state)

  return {
    state: { status: "idle", attempt: state.attempt, active },
    effects: state.status === "pending" ? CLEAR_TIMER : NO_EFFECTS,
  }
}

function stay(state: CommentFocusState): CommentFocusTransition {
  return { state, effects: NO_EFFECTS }
}

function sameTarget(a: CommentTarget | null, b: CommentTarget | null) {
  return a?.file === b?.file && a?.id === b?.id
}

// Callers pass objects they keep; the state holds its own copy.
function copy(target: CommentTarget): CommentTarget {
  return { file: target.file, id: target.id }
}
