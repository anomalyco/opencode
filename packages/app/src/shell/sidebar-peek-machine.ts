// How long the pointer rests before the sidebar peeks, in ms. The edge stays quick: it's crossed in a frame or two and
// rarely by accident. The toggle waits longer, because the header row is crossed far more often on the way to the
// breadcrumb or the traffic lights, and a peek there should only open when the pointer means to rest on it.
export const SIDEBAR_PEEK_DWELL_MS = Object.freeze({ edge: 40, toggle: 500 })

// How long the pointer may stray past the sidebar and toggle before the peek closes.
export const SIDEBAR_PEEK_GRACE_MS = 100

// How often an open peek rereads the pointer when nothing moves, as when the pointer left the window.
export const SIDEBAR_PEEK_WATCH_MS = 150

// Bounded fallback for the slide out, when frames stop arriving, as in a hidden tab.
export const SIDEBAR_PEEK_LEAVE_TIMEOUT_MS = 800

// Bounded fallback for a dock from a peek, when the docked sidebar's flight never reports that it landed.
export const SIDEBAR_PEEK_HANDOFF_TIMEOUT_MS = 1_000

export type SidebarPeekTrigger = "edge" | "toggle"

/**
 * The collapsed vertical sidebar's hover peek. `attempt` advances on entering each phase that waits on a timer, a
 * slide or a dock, so a late result from an earlier phase is ignored.
 */
export type SidebarPeekState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "dwelling"; readonly from: SidebarPeekTrigger; readonly attempt: number }
  | { readonly status: "peeking"; readonly attempt: number }
  | { readonly status: "grace"; readonly attempt: number }
  | { readonly status: "leaving"; readonly attempt: number; readonly restoreFocus: boolean }
  | { readonly status: "handing-off"; readonly attempt: number }
  | { readonly status: "disposed" }

export type SidebarPeekEvent =
  /**
   * A pointer move, wheel, scroll, window exit or watch tick. `canStartEdge`: the pointer rests in the start edge's
   * zone and a peek may start. `keepOpen`: the pointer is within the toggle-to-sidebar corridor, or the peek is held.
   */
  | { readonly type: "pointer.sampled"; readonly canStartEdge: boolean; readonly keepOpen: boolean }
  /** The pointer entered a collapsed toggle outside the sidebar. `canPeek`: a peek may start. */
  | { readonly type: "toggle.enter"; readonly canPeek: boolean }
  | { readonly type: "toggle.leave" }
  /** `ready`: the pointer still qualifies and nothing interrupted the dwell. */
  | { readonly type: "dwell.elapsed"; readonly attempt: number; readonly ready: boolean }
  /** `keepOpen`: the pointer is back within the corridor, or the peek is held, when the grace ends. */
  | { readonly type: "grace.elapsed"; readonly attempt: number; readonly keepOpen: boolean }
  /** A press, a drag or a resize: cancels a pending dwell, leaving an open peek alone. */
  | { readonly type: "interrupt" }
  | { readonly type: "escape" }
  | { readonly type: "blur" }
  /** Keyboard focus moved out of the sidebar, its toggle and its menus. */
  | { readonly type: "focus.left" }
  | { readonly type: "dock.opened" }
  | { readonly type: "dock.closed" }
  | { readonly type: "dock.settled"; readonly attempt: number }
  | { readonly type: "leave.settled"; readonly attempt: number }
  /** The vertical sidebar is gone, as when tabs move to the titlebar. */
  | { readonly type: "disabled" }
  | { readonly type: "disposed" }

export type SidebarPeekEffect =
  | {
      readonly type: "dwell.start"
      readonly from: SidebarPeekTrigger
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "dwell.clear" }
  | { readonly type: "grace.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "grace.clear" }
  | { readonly type: "watch.start"; readonly intervalMs: number }
  | { readonly type: "watch.stop" }
  /** Moves focus out of the sidebar, back to the toggle when `restoreToggle`. */
  | { readonly type: "focus.evict"; readonly restoreToggle: boolean }
  | { readonly type: "spring.open" }
  | { readonly type: "spring.close"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "leave.clear" }
  | { readonly type: "handoff.await"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "handoff.clear" }
  /** Stops the slide, and paints the sidebar as no longer peeking. */
  | { readonly type: "peek.reset" }

export const INITIAL_SIDEBAR_PEEK_STATE: SidebarPeekState = Object.freeze({ status: "idle", attempt: 0 })

export const DISPOSED_SIDEBAR_PEEK_STATE: SidebarPeekState = Object.freeze({ status: "disposed" })

// Every pointer move dispatches one of these, so sampling allocates nothing.
const SAMPLES: readonly SidebarPeekEvent[] = [
  Object.freeze({ type: "pointer.sampled", canStartEdge: false, keepOpen: false }),
  Object.freeze({ type: "pointer.sampled", canStartEdge: false, keepOpen: true }),
  Object.freeze({ type: "pointer.sampled", canStartEdge: true, keepOpen: false }),
  Object.freeze({ type: "pointer.sampled", canStartEdge: true, keepOpen: true }),
]

const TOGGLE_ENTER_READY: SidebarPeekEvent = Object.freeze({ type: "toggle.enter", canPeek: true })

const TOGGLE_ENTER_BLOCKED: SidebarPeekEvent = Object.freeze({ type: "toggle.enter", canPeek: false })

export const PEEK_TOGGLE_LEAVE_EVENT: SidebarPeekEvent = Object.freeze({ type: "toggle.leave" })

export const PEEK_INTERRUPT_EVENT: SidebarPeekEvent = Object.freeze({ type: "interrupt" })

export const PEEK_ESCAPE_EVENT: SidebarPeekEvent = Object.freeze({ type: "escape" })

export const PEEK_BLUR_EVENT: SidebarPeekEvent = Object.freeze({ type: "blur" })

export const PEEK_FOCUS_LEFT_EVENT: SidebarPeekEvent = Object.freeze({ type: "focus.left" })

export const PEEK_DOCK_OPENED_EVENT: SidebarPeekEvent = Object.freeze({ type: "dock.opened" })

export const PEEK_DOCK_CLOSED_EVENT: SidebarPeekEvent = Object.freeze({ type: "dock.closed" })

export const PEEK_DISABLED_EVENT: SidebarPeekEvent = Object.freeze({ type: "disabled" })

export const PEEK_DISPOSED_EVENT: SidebarPeekEvent = Object.freeze({ type: "disposed" })

export function samplePointerEvent(canStartEdge: boolean, keepOpen: boolean) {
  return SAMPLES[(canStartEdge ? 2 : 0) + (keepOpen ? 1 : 0)]!
}

export function toggleEnterEvent(canPeek: boolean) {
  return canPeek ? TOGGLE_ENTER_READY : TOGGLE_ENTER_BLOCKED
}

export function transitionSidebarPeek(state: SidebarPeekState, event: SidebarPeekEvent): SidebarPeekState {
  if (state.status === "disposed") return state

  if (event.type === "pointer.sampled") return sampled(state, event)

  if (event.type === "disposed") return DISPOSED_SIDEBAR_PEEK_STATE

  if (event.type === "disabled") return state.status === "idle" ? state : idle(state.attempt)

  if (state.status === "idle") {
    if (event.type === "toggle.enter" && event.canPeek) return dwelling("toggle", state.attempt + 1)

    return state
  }

  if (state.status === "dwelling") {
    if (event.type === "toggle.enter") {
      if (!event.canPeek) return idle(state.attempt)

      return state.from === "toggle" ? state : dwelling("toggle", state.attempt + 1)
    }

    if (event.type === "toggle.leave") return state.from === "toggle" ? idle(state.attempt) : state

    if (event.type === "dwell.elapsed") {
      if (event.attempt !== state.attempt) return state

      return event.ready ? { status: "peeking", attempt: state.attempt } : idle(state.attempt)
    }

    if (
      event.type === "interrupt" ||
      event.type === "escape" ||
      event.type === "blur" ||
      event.type === "dock.opened" ||
      event.type === "dock.closed"
    )
      return idle(state.attempt)

    return state
  }

  if (state.status === "peeking") return close(state, event)

  if (state.status === "grace") {
    if (event.type === "toggle.enter") return event.canPeek ? { status: "peeking", attempt: state.attempt } : state

    if (event.type === "grace.elapsed") {
      if (event.attempt !== state.attempt) return state

      return event.keepOpen ? { status: "peeking", attempt: state.attempt } : leaving(state.attempt + 1, false)
    }

    return close(state, event)
  }

  if (state.status === "leaving") {
    if (event.type === "toggle.enter") return event.canPeek ? { status: "peeking", attempt: state.attempt + 1 } : state

    if (event.type === "dock.opened") return { status: "handing-off", attempt: state.attempt + 1 }

    if (event.type === "leave.settled") return event.attempt === state.attempt ? idle(state.attempt) : state

    return state
  }

  if (event.type === "dock.closed") return leaving(state.attempt + 1, false)

  if (event.type === "dock.settled") return event.attempt === state.attempt ? idle(state.attempt) : state

  return state
}

/** The effects that carry the driver from `previous` to `next`: what the previous phase leaves, and the next starts. */
export function sidebarPeekEffects(previous: SidebarPeekState, next: SidebarPeekState): readonly SidebarPeekEffect[] {
  if (previous === next) return NO_EFFECTS
  const effects: SidebarPeekEffect[] = []

  if (previous.status === "dwelling") effects.push(DWELL_CLEAR)

  if (previous.status === "grace") effects.push(GRACE_CLEAR)

  if (previous.status === "leaving") effects.push(LEAVE_CLEAR)

  if (previous.status === "handing-off") effects.push(HANDOFF_CLEAR)

  const watched = selectNeedsCorridorSample(previous)

  if (watched && !selectNeedsCorridorSample(next)) effects.push(WATCH_STOP)

  if (next.status === "dwelling")
    effects.push({
      type: "dwell.start",
      from: next.from,
      attempt: next.attempt,
      delayMs: SIDEBAR_PEEK_DWELL_MS[next.from],
    })

  if (next.status === "grace")
    effects.push({ type: "grace.start", attempt: next.attempt, delayMs: SIDEBAR_PEEK_GRACE_MS })

  if (next.status === "peeking" && !watched) effects.push(WATCH_START, SPRING_OPEN)

  if (next.status === "leaving")
    effects.push(
      { type: "focus.evict", restoreToggle: next.restoreFocus },
      { type: "spring.close", attempt: next.attempt, timeoutMs: SIDEBAR_PEEK_LEAVE_TIMEOUT_MS },
    )

  if (next.status === "handing-off")
    effects.push(SPRING_OPEN, {
      type: "handoff.await",
      attempt: next.attempt,
      timeoutMs: SIDEBAR_PEEK_HANDOFF_TIMEOUT_MS,
    })

  if (selectPeekShown(previous) && !selectPeekShown(next)) effects.push(PEEK_RESET)

  return effects
}

/** Whether the sidebar shows as a peek, sliding in, open, or sliding out. */
export function selectPeekShown(state: SidebarPeekState) {
  return (
    state.status === "peeking" ||
    state.status === "grace" ||
    state.status === "leaving" ||
    state.status === "handing-off"
  )
}

/** Whether the sidebar is docking from a peek, which already shows it. */
export function selectPeekHandedOff(state: SidebarPeekState) {
  return state.status === "handing-off"
}

/** Whether a pointer move can start or cancel the edge's dwell, or turn a slide out around. */
export function selectNeedsEdgeSample(state: SidebarPeekState) {
  return state.status === "idle" || state.status === "dwelling" || state.status === "leaving"
}

/** Whether the pointer leaving the toggle-to-sidebar corridor starts, or its return cancels, the close's grace. */
export function selectNeedsCorridorSample(state: SidebarPeekState) {
  return state.status === "peeking" || state.status === "grace"
}

const NO_EFFECTS: readonly SidebarPeekEffect[] = Object.freeze([])

const DWELL_CLEAR: SidebarPeekEffect = Object.freeze({ type: "dwell.clear" })

const GRACE_CLEAR: SidebarPeekEffect = Object.freeze({ type: "grace.clear" })

const LEAVE_CLEAR: SidebarPeekEffect = Object.freeze({ type: "leave.clear" })

const HANDOFF_CLEAR: SidebarPeekEffect = Object.freeze({ type: "handoff.clear" })

const WATCH_START: SidebarPeekEffect = Object.freeze({ type: "watch.start", intervalMs: SIDEBAR_PEEK_WATCH_MS })

const WATCH_STOP: SidebarPeekEffect = Object.freeze({ type: "watch.stop" })

const SPRING_OPEN: SidebarPeekEffect = Object.freeze({ type: "spring.open" })

const PEEK_RESET: SidebarPeekEffect = Object.freeze({ type: "peek.reset" })

function sampled(
  state: Exclude<SidebarPeekState, { status: "disposed" }>,
  event: { readonly canStartEdge: boolean; readonly keepOpen: boolean },
): SidebarPeekState {
  if (state.status === "idle") return event.canStartEdge ? dwelling("edge", state.attempt + 1) : state

  if (state.status === "dwelling") return state.from === "toggle" || event.canStartEdge ? state : idle(state.attempt)

  if (state.status === "peeking") return event.keepOpen ? state : { status: "grace", attempt: state.attempt + 1 }

  if (state.status === "grace") return event.keepOpen ? { status: "peeking", attempt: state.attempt } : state

  // Back at the edge while it slides out: it turns around at once.
  if (state.status === "leaving") return event.canStartEdge ? { status: "peeking", attempt: state.attempt + 1 } : state

  return state
}

// Escape, a blur, keyboard focus leaving or the dock closing slide an open peek out; the dock opening keeps it.
function close(
  state: Extract<SidebarPeekState, { status: "peeking" | "grace" }>,
  event: SidebarPeekEvent,
): SidebarPeekState {
  if (event.type === "escape") return leaving(state.attempt + 1, true)

  if (event.type === "blur" || event.type === "focus.left" || event.type === "dock.closed")
    return leaving(state.attempt + 1, false)

  if (event.type === "dock.opened") return { status: "handing-off", attempt: state.attempt + 1 }

  return state
}

function idle(attempt: number): SidebarPeekState {
  return { status: "idle", attempt }
}

function dwelling(from: SidebarPeekTrigger, attempt: number): SidebarPeekState {
  return { status: "dwelling", from, attempt }
}

function leaving(attempt: number, restoreFocus: boolean): SidebarPeekState {
  return { status: "leaving", attempt, restoreFocus }
}
