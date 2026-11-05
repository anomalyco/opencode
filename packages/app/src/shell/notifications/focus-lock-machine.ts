/**
 * The shared Web Lock a focused window holds so other windows skip system notifications. `requesting` waits for the
 * grant and tracks focus meanwhile; a grant that arrives after the window lost focus is released at once.
 */
export type FocusLockState =
  | { readonly status: "unfocused"; readonly attempt: number }
  | { readonly status: "requesting"; readonly attempt: number; readonly focused: boolean }
  | { readonly status: "held"; readonly attempt: number }
  | { readonly status: "disposed" }

export type FocusLockEvent =
  | { readonly type: "focus.changed"; readonly focused: boolean }
  | { readonly type: "lock.acquired"; readonly attempt: number }
  | { readonly type: "lock.failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type FocusLockEffect =
  | { readonly type: "lock.acquire"; readonly attempt: number }
  | { readonly type: "lock.release"; readonly attempt: number }

export type FocusLockTransition = {
  readonly state: FocusLockState
  readonly effects: readonly FocusLockEffect[]
}

export const INITIAL_FOCUS_LOCK_STATE: FocusLockState = Object.freeze({ status: "unfocused", attempt: 0 })

const DISPOSED: FocusLockState = Object.freeze({ status: "disposed" })

const NONE: readonly FocusLockEffect[] = []

export function transitionFocusLock(state: FocusLockState, event: FocusLockEvent): FocusLockTransition {
  // Every grant nobody wants is released, or the lock would be held until the window closes.
  const release: readonly FocusLockEffect[] =
    event.type === "lock.acquired" ? [{ type: "lock.release", attempt: event.attempt }] : NONE

  if (state.status === "disposed") return { state, effects: release }

  if (event.type === "disposed")
    return { state: DISPOSED, effects: state.status === "held" ? [{ type: "lock.release", attempt: state.attempt }] : NONE }

  if (event.type === "focus.changed") {
    if (state.status === "unfocused") {
      if (!event.focused) return unchanged(state)
      const attempt = state.attempt + 1

      return { state: { status: "requesting", attempt, focused: true }, effects: [{ type: "lock.acquire", attempt }] }
    }

    if (state.status === "requesting")
      return state.focused === event.focused
        ? unchanged(state)
        : { state: { ...state, focused: event.focused }, effects: NONE }

    if (event.focused) return unchanged(state)

    return {
      state: { status: "unfocused", attempt: state.attempt },
      effects: [{ type: "lock.release", attempt: state.attempt }],
    }
  }

  if (state.status !== "requesting" || state.attempt !== event.attempt) return { state, effects: release }

  if (event.type === "lock.failed" || !state.focused)
    return { state: { status: "unfocused", attempt: state.attempt }, effects: release }

  return { state: { status: "held", attempt: state.attempt }, effects: NONE }
}

function unchanged(state: FocusLockState): FocusLockTransition {
  return { state, effects: NONE }
}
