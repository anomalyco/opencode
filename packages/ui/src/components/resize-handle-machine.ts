export type ResizeDirection = "horizontal" | "vertical"

export type ResizeEdge = "start" | "end"

/** Fixed for one press: where it started, which way the size grows, and the limits it resizes within. */
export type ResizeSession = {
  readonly pointerId: number
  readonly direction: ResizeDirection
  readonly sign: 1 | -1
  readonly startPos: number
  readonly startSize: number
  readonly min: number
  readonly max: number
  readonly threshold: number
}

/**
 * `pressed` holds the pointer before it moves, so a click never reports a drag. `dragging` reports the size on each
 * move; `collapsed` is set while the raw size sits below the collapse threshold.
 */
export type ResizeHandleState =
  | { readonly status: "idle" }
  | { readonly status: "pressed"; readonly session: ResizeSession }
  | { readonly status: "dragging"; readonly session: ResizeSession; readonly collapsed: boolean }
  | { readonly status: "disposed" }

export type ResizeHandleEvent =
  | {
      readonly type: "pointer.down"
      readonly button: number
      readonly ctrlKey: boolean
      readonly detail: number
      readonly session: ResizeSession
    }
  // The driver reuses one move event object, so a drag allocates nothing per move.
  | { type: "pointer.moved"; pointerId: number; pos: number }
  | { readonly type: "pointer.up"; readonly pointerId: number }
  /** Blur, `pointercancel` or lost capture; no `pointerId` cancels whichever pointer holds the handle. */
  | { readonly type: "drag.cancelled"; readonly pointerId?: number }
  | { readonly type: "disposed" }

export type ResizeHandleEffect =
  | "lock-body"
  | "unlock-body"
  | "dragging-true"
  | "dragging-false"
  | "collapse-true"
  | "collapse-false"
  | "collapse-commit"
  | "resize"

export type ResizeHandleTransition = {
  readonly state: ResizeHandleState
  readonly effects: readonly ResizeHandleEffect[]
}

const IDLE: ResizeHandleState = Object.freeze({ status: "idle" })

const DISPOSED: ResizeHandleState = Object.freeze({ status: "disposed" })

export const INITIAL_RESIZE_HANDLE_STATE: ResizeHandleState = IDLE

export const RESIZE_HANDLE_DISPOSED: ResizeHandleEvent = Object.freeze({ type: "disposed" })

export const RESIZE_DRAG_CANCELLED: ResizeHandleEvent = Object.freeze({ type: "drag.cancelled" })

const NONE: readonly ResizeHandleEffect[] = Object.freeze([])

const LOCK: readonly ResizeHandleEffect[] = Object.freeze(["lock-body"])

const UNLOCK: readonly ResizeHandleEffect[] = Object.freeze(["unlock-body"])

const RESIZE: readonly ResizeHandleEffect[] = Object.freeze(["resize"])

const START: readonly ResizeHandleEffect[] = Object.freeze(["dragging-true", "resize"])

const START_COLLAPSED: readonly ResizeHandleEffect[] = Object.freeze(["dragging-true", "collapse-true", "resize"])

const COLLAPSE: readonly ResizeHandleEffect[] = Object.freeze(["collapse-true", "resize"])

const EXPAND: readonly ResizeHandleEffect[] = Object.freeze(["collapse-false", "resize"])

const END: readonly ResizeHandleEffect[] = Object.freeze(["unlock-body", "dragging-false"])

const END_COLLAPSED: readonly ResizeHandleEffect[] = Object.freeze(["unlock-body", "dragging-false", "collapse-false"])

const COMMIT: readonly ResizeHandleEffect[] = Object.freeze(["unlock-body", "dragging-false", "collapse-commit"])

export function resizeSign(direction: ResizeDirection, edge: ResizeEdge, rtl: boolean): 1 | -1 {
  if (direction === "vertical") return edge === "end" ? 1 : -1

  return (edge === "start") !== rtl ? -1 : 1
}

/** The size before clamping, which decides collapse, so dragging past `min` can still collapse the panel. */
export function rawResizeSize(session: ResizeSession, pos: number) {
  return session.startSize + session.sign * (pos - session.startPos)
}

export function resizeSize(session: ResizeSession, pos: number) {
  return Math.min(session.max, Math.max(session.min, rawResizeSize(session, pos)))
}

export function transitionResizeHandle(state: ResizeHandleState, event: ResizeHandleEvent): ResizeHandleTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  switch (event.type) {
    case "disposed":
      return { state: DISPOSED, effects: release(state) }
    case "pointer.down":
      if (state.status !== "idle" || event.button !== 0 || event.ctrlKey || event.detail > 1)
        return { state, effects: NONE }

      return { state: { status: "pressed", session: event.session }, effects: LOCK }
    case "pointer.moved":
      return move(state, event)
    case "pointer.up":
      if (state.status === "idle" || event.pointerId !== state.session.pointerId) return { state, effects: NONE }

      return { state: IDLE, effects: state.status === "dragging" && state.collapsed ? COMMIT : release(state) }
    case "drag.cancelled":
      if (state.status === "idle") return { state, effects: NONE }

      if (event.pointerId !== undefined && event.pointerId !== state.session.pointerId) return { state, effects: NONE }

      return { state: IDLE, effects: release(state) }
  }
}

export function selectResizeHandleActive(state: ResizeHandleState) {
  return state.status === "pressed" || state.status === "dragging"
}

// Collapse state is reported only while it is in effect: a press that never collapsed reports nothing on release.
function release(state: Exclude<ResizeHandleState, { status: "disposed" }>) {
  if (state.status === "idle") return NONE

  if (state.status === "pressed") return UNLOCK

  return state.collapsed ? END_COLLAPSED : END
}

const KEEP = new WeakMap<ResizeHandleState, ResizeHandleTransition>()

function move(
  state: ResizeHandleState,
  event: Extract<ResizeHandleEvent, { type: "pointer.moved" }>,
): ResizeHandleTransition {
  if (state.status !== "pressed" && state.status !== "dragging") return { state, effects: NONE }

  if (event.pointerId !== state.session.pointerId) return { state, effects: NONE }

  if (state.status === "pressed" && event.pos === state.session.startPos) return { state, effects: NONE }

  const collapsed = state.session.threshold > 0 && rawResizeSize(state.session, event.pos) < state.session.threshold

  if (state.status === "pressed")
    return {
      state: { status: "dragging", session: state.session, collapsed },
      effects: collapsed ? START_COLLAPSED : START,
    }

  if (collapsed !== state.collapsed)
    return { state: { status: "dragging", session: state.session, collapsed }, effects: collapsed ? COLLAPSE : EXPAND }

  // A move that keeps the phase returns one cached transition per state, so `pointermove` allocates nothing.
  const cached = KEEP.get(state)

  if (cached) return cached
  const kept = Object.freeze({ state, effects: RESIZE })
  KEEP.set(state, kept)

  return kept
}
