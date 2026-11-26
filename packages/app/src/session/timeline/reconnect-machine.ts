// TanStack's reset timer can still report a stale offset in the frame after its deadline, so the check outlives it.
export const RECONNECT_POST_DEADLINE_FRAMES = 2

export const RECONNECT_OFFSET_EPSILON = 1

/**
 * Whether the scroll element is in the document. A reattached element resets its native `scrollTop`, so `checking`
 * compares it with the virtualizer's offset every frame until the reset delay has passed.
 */
export type ReconnectState =
  | { readonly status: "attached"; readonly attempt: number }
  | { readonly status: "detached"; readonly attempt: number }
  | {
      readonly status: "checking"
      readonly attempt: number
      readonly deadline: number
      readonly framesAfterDeadline: number
    }
  | { readonly status: "disposed" }

export type ReconnectEvent =
  /**
   * One MutationObserver batch. `connected` is the element's final connection; `added` means an external record
   * inserted the element or one of its ancestors.
   */
  | {
      readonly type: "mutated"
      readonly connected: boolean
      readonly added: boolean
      readonly deadline: number
    }
  | {
      readonly type: "frame"
      readonly attempt: number
      readonly time: number
      readonly connected: boolean
      readonly nativeTop: number
      readonly virtualOffset: number | null
    }
  | { readonly type: "disposed" }

export type ReconnectEffect =
  | { readonly type: "reconnected" }
  | { readonly type: "frame.schedule"; readonly attempt: number }
  | { readonly type: "frame.cancel" }
  | { readonly type: "offset.deliver"; readonly offset: number }

export type ReconnectTransition = {
  readonly state: ReconnectState
  readonly effects: readonly ReconnectEffect[]
}

export const DISPOSED_RECONNECT_EVENT: ReconnectEvent = Object.freeze({ type: "disposed" })

const DISPOSED_STATE: ReconnectState = Object.freeze({ status: "disposed" })

const NO_EFFECTS: readonly ReconnectEffect[] = Object.freeze([])

const FRAME_CANCEL: readonly ReconnectEffect[] = Object.freeze([{ type: "frame.cancel" }])

const RECONNECTED: ReconnectEffect = Object.freeze({ type: "reconnected" })

const FRAME_CANCEL_EFFECT: ReconnectEffect = Object.freeze({ type: "frame.cancel" })

// Cached views can be constructed before their first attachment to the page.
export function createReconnectState(connected: boolean): ReconnectState {
  return connected ? { status: "attached", attempt: 0 } : { status: "detached", attempt: 0 }
}

export function transitionReconnect(state: ReconnectState, event: ReconnectEvent): ReconnectTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return { state: DISPOSED_STATE, effects: state.status === "checking" ? FRAME_CANCEL : NO_EFFECTS }

  if (event.type === "mutated") {
    // A removed ancestor detaches the element whether or not the removal record still contains it.
    if (!event.connected) {
      if (state.status === "detached") return unchanged(state)

      return {
        state: { status: "detached", attempt: state.attempt + 1 },
        effects: state.status === "checking" ? FRAME_CANCEL : NO_EFFECTS,
      }
    }

    if (state.status !== "detached" && !event.added) return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "checking", attempt, deadline: event.deadline, framesAfterDeadline: 0 },
      effects: [
        ...(state.status === "checking" ? [FRAME_CANCEL_EFFECT] : NO_EFFECTS),
        RECONNECTED,
        { type: "frame.schedule", attempt },
      ],
    }
  }

  if (state.status !== "checking" || state.attempt !== event.attempt) return unchanged(state)

  const divergent =
    event.connected &&
    (event.virtualOffset === null || Math.abs(event.nativeTop - event.virtualOffset) > RECONNECT_OFFSET_EPSILON)

  const after = state.framesAfterDeadline + (event.time >= state.deadline ? 1 : 0)
  const done = after >= RECONNECT_POST_DEADLINE_FRAMES

  const next: ReconnectState = done
    ? { status: "attached", attempt: state.attempt + 1 }
    : after === state.framesAfterDeadline
      ? state
      : { ...state, framesAfterDeadline: after }

  return {
    state: next,
    effects: [
      ...(divergent ? [{ type: "offset.deliver" as const, offset: event.nativeTop }] : NO_EFFECTS),
      ...(done ? NO_EFFECTS : [{ type: "frame.schedule" as const, attempt: state.attempt }]),
    ],
  }
}

export function isReconnectObserverActive(state: ReconnectState) {
  return state.status !== "disposed"
}

function unchanged(state: ReconnectState): ReconnectTransition {
  return { state, effects: NO_EFFECTS }
}
