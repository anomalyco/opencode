import type { SessionPane } from "@/shell/state/session-tabs"

/** How far the pointer moves from the press before the tab drags; a shorter press is a click. */
export const DRAG_THRESHOLD_PX = 4

export type Rect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** Where a dragged tab lands: before a tab in a pane's strip (its end without `before`), or in a pane. */
export type PaneDropTarget = {
  readonly pane: SessionPane
  readonly before?: string
  readonly strip: boolean
  readonly rect: Rect
}

export type PaneDragState =
  | { readonly status: "idle" }
  /** The primary button is down on a tab, but has not moved far enough to drag it. */
  | {
      readonly status: "pressed"
      readonly pointerId: number
      readonly key: string
      readonly title: string
      readonly originX: number
      readonly originY: number
    }
  | {
      readonly status: "dragging"
      readonly pointerId: number
      readonly key: string
      readonly title: string
      readonly x: number
      readonly y: number
      /** Undefined away from every drop zone, where a release cancels. */
      readonly target: PaneDropTarget | undefined
    }
  | { readonly status: "disposed" }

export type DraggingPaneState = Extract<PaneDragState, { readonly status: "dragging" }>

export type PaneDragEvent =
  | {
      readonly type: "pointer.down"
      readonly pointerId: number
      readonly button: number
      readonly x: number
      readonly y: number
      readonly key: string
      readonly title: string
    }
  | {
      readonly type: "pointer.move"
      readonly pointerId: number
      readonly x: number
      readonly y: number
      readonly target: PaneDropTarget | undefined
    }
  | { readonly type: "pointer.up"; readonly pointerId: number }
  | { readonly type: "pointer.cancel"; readonly pointerId: number }
  | { readonly type: "escape" }
  | { readonly type: "blur" }
  /** The screen now shows another session, whose tabs the release must not move. */
  | { readonly type: "session.changed" }
  | { readonly type: "disposed" }

export type PaneDragCursor = "grabbing" | ""

export type PaneDragEffect =
  /** Listens on the window for the gesture's pointer, Escape and blur. */
  | { readonly type: "gesture.attach" }
  /** Stops listening, and restores the body's selection and cursor once a drag locked them. */
  | { readonly type: "gesture.cleanup"; readonly unlockBody: boolean }
  | { readonly type: "body.lock"; readonly cursor: PaneDragCursor }
  | { readonly type: "body.cursor"; readonly cursor: PaneDragCursor }
  /** Swallows clicks until the next task: the release over a strip would click the tab under it. */
  | { readonly type: "click-suppression.arm" }
  | { readonly type: "click-suppression.clear" }
  | { readonly type: "drop"; readonly key: string; readonly target: PaneDropTarget }

export type PaneDragTransition = {
  readonly state: PaneDragState
  readonly effects: readonly PaneDragEffect[]
}

export const INITIAL_PANE_DRAG_STATE: PaneDragState = Object.freeze({ status: "idle" })

export const DISPOSED_PANE_DRAG_STATE: PaneDragState = Object.freeze({ status: "disposed" })

const EMPTY_EFFECTS: readonly PaneDragEffect[] = Object.freeze([])

const ATTACH: readonly PaneDragEffect[] = Object.freeze([{ type: "gesture.attach" }])

const CLEANUP_PRESSED: readonly PaneDragEffect[] = Object.freeze([{ type: "gesture.cleanup", unlockBody: false }])

const CLEANUP_DRAGGING: readonly PaneDragEffect[] = Object.freeze([{ type: "gesture.cleanup", unlockBody: true }])

const RELEASE: readonly PaneDragEffect[] = Object.freeze([...CLEANUP_DRAGGING, { type: "click-suppression.arm" }])

const LOCK_GRABBING: readonly PaneDragEffect[] = Object.freeze([{ type: "body.lock", cursor: "grabbing" }])

const LOCK_DEFAULT: readonly PaneDragEffect[] = Object.freeze([{ type: "body.lock", cursor: "" }])

const CURSOR_GRABBING: readonly PaneDragEffect[] = Object.freeze([{ type: "body.cursor", cursor: "grabbing" }])

const CURSOR_DEFAULT: readonly PaneDragEffect[] = Object.freeze([{ type: "body.cursor", cursor: "" }])

// The click swallower outlives the gesture by one task, so every disposal clears it.
const DISPOSE_IDLE: readonly PaneDragEffect[] = Object.freeze([{ type: "click-suppression.clear" }])

const DISPOSE_PRESSED: readonly PaneDragEffect[] = Object.freeze([...CLEANUP_PRESSED, ...DISPOSE_IDLE])

const DISPOSE_DRAGGING: readonly PaneDragEffect[] = Object.freeze([...CLEANUP_DRAGGING, ...DISPOSE_IDLE])

export function transitionPaneDrag(state: PaneDragState, event: PaneDragEvent): PaneDragTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return disposed(state)

  if (state.status === "idle") return idle(state, event)

  if (state.status === "pressed") return pressed(state, event)

  return dragging(state, event)
}

/** The dragged tab's key while a drag shows; undefined while idle, pressed or disposed. */
export function selectDraggingKey(state: PaneDragState) {
  return state.status === "dragging" ? state.key : undefined
}

/** The drag the floating layer draws, or undefined when nothing shows. */
export function selectDragLayer(state: PaneDragState) {
  return state.status === "dragging" ? state : undefined
}

/**
 * The dragged tab's key when a move of `pointerId` to `(x, y)` changes the gesture: it is the gesture's pointer, and it
 * drags or crosses the threshold. The driver hit-tests drop zones only then.
 */
export function selectMoveKey(state: PaneDragState, pointerId: number, x: number, y: number) {
  if (state.status === "dragging") return state.pointerId === pointerId ? state.key : undefined

  if (state.status !== "pressed" || state.pointerId !== pointerId) return undefined

  return Math.hypot(x - state.originX, y - state.originY) >= DRAG_THRESHOLD_PX ? state.key : undefined
}

function idle(state: Extract<PaneDragState, { status: "idle" }>, event: PaneDragEvent): PaneDragTransition {
  if (event.type !== "pointer.down" || event.button !== 0) return unchanged(state)

  return {
    state: {
      status: "pressed",
      pointerId: event.pointerId,
      key: event.key,
      title: event.title,
      originX: event.x,
      originY: event.y,
    },
    effects: ATTACH,
  }
}

// A second pointer (another finger, or a pen) neither starts a parallel gesture nor moves or ends this one.
function pressed(state: Extract<PaneDragState, { status: "pressed" }>, event: PaneDragEvent): PaneDragTransition {
  if (event.type === "pointer.move") {
    if (selectMoveKey(state, event.pointerId, event.x, event.y) === undefined) return unchanged(state)

    return {
      state: {
        status: "dragging",
        pointerId: state.pointerId,
        key: state.key,
        title: state.title,
        x: event.x,
        y: event.y,
        target: event.target,
      },
      effects: event.target ? LOCK_GRABBING : LOCK_DEFAULT,
    }
  }

  if (event.type === "pointer.up" || event.type === "pointer.cancel") {
    if (event.pointerId !== state.pointerId) return unchanged(state)

    return { state: INITIAL_PANE_DRAG_STATE, effects: CLEANUP_PRESSED }
  }

  if (event.type === "escape" || event.type === "blur" || event.type === "session.changed")
    return { state: INITIAL_PANE_DRAG_STATE, effects: CLEANUP_PRESSED }

  return unchanged(state)
}

function dragging(state: DraggingPaneState, event: PaneDragEvent): PaneDragTransition {
  if (event.type === "pointer.move") {
    if (event.pointerId !== state.pointerId) return unchanged(state)

    const same = sameTarget(state.target, event.target)

    if (same && event.x === state.x && event.y === state.y) return unchanged(state)

    return {
      state: { ...state, x: event.x, y: event.y, target: same ? state.target : event.target },
      effects: cursor(state.target, event.target),
    }
  }

  if (event.type === "pointer.up") {
    if (event.pointerId !== state.pointerId) return unchanged(state)

    return {
      state: INITIAL_PANE_DRAG_STATE,
      effects: state.target ? [...RELEASE, { type: "drop", key: state.key, target: state.target }] : RELEASE,
    }
  }

  if (event.type === "pointer.cancel") {
    if (event.pointerId !== state.pointerId) return unchanged(state)

    return { state: INITIAL_PANE_DRAG_STATE, effects: CLEANUP_DRAGGING }
  }

  if (event.type === "escape" || event.type === "blur" || event.type === "session.changed")
    return { state: INITIAL_PANE_DRAG_STATE, effects: CLEANUP_DRAGGING }

  return unchanged(state)
}

function disposed(state: PaneDragState): PaneDragTransition {
  if (state.status === "pressed") return { state: DISPOSED_PANE_DRAG_STATE, effects: DISPOSE_PRESSED }

  if (state.status === "dragging") return { state: DISPOSED_PANE_DRAG_STATE, effects: DISPOSE_DRAGGING }

  return { state: DISPOSED_PANE_DRAG_STATE, effects: DISPOSE_IDLE }
}

// Away from every drop zone the release cancels, so the cursor stays normal there.
function cursor(previous: PaneDropTarget | undefined, next: PaneDropTarget | undefined) {
  if (Boolean(previous) === Boolean(next)) return EMPTY_EFFECTS

  return next ? CURSOR_GRABBING : CURSOR_DEFAULT
}

function sameTarget(a: PaneDropTarget | undefined, b: PaneDropTarget | undefined) {
  if (a === b) return true

  if (!a || !b) return false

  return (
    a.pane === b.pane &&
    a.before === b.before &&
    a.strip === b.strip &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  )
}

function unchanged(state: PaneDragState): PaneDragTransition {
  return { state, effects: EMPTY_EFFECTS }
}
