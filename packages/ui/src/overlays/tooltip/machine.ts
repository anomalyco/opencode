/**
 * Every tooltip trigger runs this machine, so it never allocates: each reachable state, event and transition is a
 * frozen module singleton, and an event that changes nothing returns the state it was given.
 */
export type TooltipState =
  /** Kobalte is not mounted yet. Most triggers are never hovered, so it mounts on the first hover or focus. */
  | { readonly status: "unmounted"; readonly disabled: boolean }
  | { readonly status: "idle"; readonly hovered: boolean; readonly disabled: boolean }
  | { readonly status: "open"; readonly hovered: boolean }
  /** A press keeps the tooltip hidden until the next hover or keyboard focus. */
  | { readonly status: "dismissed"; readonly disabled: boolean }
  /**
   * A popup the trigger opened (a menu, a popover) hides the tooltip. While it is open, a modal layer turns pointer
   * events off for the page, so the trigger's own enter and leave events lie and `hovered` follows the pointer's
   * position instead. Once it closes over a hovered trigger, the tooltip stays hidden until the pointer moves off the
   * trigger or the trigger itself takes focus.
   */
  | { readonly status: "suppressed"; readonly popup: "open"; readonly hovered: boolean; readonly disabled: boolean }
  | { readonly status: "suppressed"; readonly popup: "closed"; readonly disabled: boolean }
  /** The caller sets `forceOpen`. `expanded` tracks the popup so releasing control can suppress the tooltip. */
  | {
      readonly status: "controlled"
      readonly open: boolean
      readonly hovered: boolean
      readonly expanded: boolean
      readonly disabled: boolean
    }
  | { readonly status: "disposed" }

export type TooltipEvent =
  | { readonly type: "props.synced"; readonly forceOpen: boolean | undefined; readonly disabled: boolean }
  /** The pointer entered or left the trigger. Touch never hovers. */
  | { readonly type: "pointer.entered" }
  | { readonly type: "pointer.left" }
  /** Where a pointer move landed while a popup suppresses the tooltip, measured against the trigger's box. */
  | { readonly type: "pointer.moved"; readonly inside: boolean }
  /** The trigger received focus independently of a pointer press. */
  | { readonly type: "focused" }
  | { readonly type: "trigger.pressed" }
  /** The microtask after the pointer left, once Kobalte has seen the tooltip open and started its skip-delay window. */
  | { readonly type: "leave.settled" }
  | { readonly type: "popup.changed"; readonly expanded: boolean }
  | { readonly type: "kobalte.changed"; readonly open: boolean }
  | { readonly type: "disposed" }

export type TooltipEffect = "replay" | "schedule-leave" | "cancel-opening" | "hide"

export type TooltipTransition = {
  readonly state: TooltipState
  readonly effects: readonly TooltipEffect[]
}

const settled = new Map<TooltipState, TooltipTransition>()

const NO_EFFECTS: readonly TooltipEffect[] = Object.freeze([])

function freeze<S extends TooltipState>(state: S) {
  Object.freeze(state)
  settled.set(state, Object.freeze({ state, effects: NO_EFFECTS }))

  return state
}

const bit = (value: boolean) => (value ? 1 : 0)

const UNMOUNTED = [false, true].map((disabled) => freeze({ status: "unmounted", disabled }))

const IDLE = [0, 1, 2, 3].map((key) => freeze({ status: "idle", hovered: !!(key & 1), disabled: !!(key & 2) }))

const OPEN = [false, true].map((hovered) => freeze({ status: "open", hovered }))

const DISMISSED = [false, true].map((disabled) => freeze({ status: "dismissed", disabled }))

const POPUP_OPEN = [0, 1, 2, 3].map((key) =>
  freeze({ status: "suppressed", popup: "open", hovered: !!(key & 1), disabled: !!(key & 2) }),
)

const POPUP_CLOSED = [false, true].map((disabled) => freeze({ status: "suppressed", popup: "closed", disabled }))

const CONTROLLED = Array.from({ length: 16 }, (_, key) =>
  freeze({
    status: "controlled",
    open: !!(key & 1),
    hovered: !!(key & 2),
    expanded: !!(key & 4),
    disabled: !!(key & 8),
  }),
)

const DISPOSED = freeze({ status: "disposed" })

const unmounted = (disabled: boolean) => UNMOUNTED[bit(disabled)]

const idle = (hovered: boolean, disabled: boolean) => IDLE[bit(hovered) | (bit(disabled) << 1)]

const open = (hovered: boolean) => OPEN[bit(hovered)]

const popupOpen = (hovered: boolean, disabled: boolean) => POPUP_OPEN[bit(hovered) | (bit(disabled) << 1)]

const popupClosed = (disabled: boolean) => POPUP_CLOSED[bit(disabled)]

const controlled = (open: boolean, hovered: boolean, expanded: boolean, disabled: boolean) =>
  CONTROLLED[bit(open) | (bit(hovered) << 1) | (bit(expanded) << 2) | (bit(disabled) << 3)]

function withEffect(state: TooltipState, effect: TooltipEffect): TooltipTransition {
  return Object.freeze({ state, effects: Object.freeze([effect]) })
}

const REPLAY_HOVER = withEffect(idle(true, false), "replay")

const LEAVING = withEffect(open(false), "schedule-leave")

const CANCEL_OPENING = withEffect(DISMISSED[0], "cancel-opening")

const HIDE = withEffect(DISMISSED[0], "hide")

export const POINTER_ENTERED: TooltipEvent = Object.freeze({ type: "pointer.entered" })

export const POINTER_LEFT: TooltipEvent = Object.freeze({ type: "pointer.left" })

export const POINTER_INSIDE: TooltipEvent = Object.freeze({ type: "pointer.moved", inside: true })

export const POINTER_OUTSIDE: TooltipEvent = Object.freeze({ type: "pointer.moved", inside: false })

export const FOCUSED: TooltipEvent = Object.freeze({ type: "focused" })

export const TRIGGER_PRESSED: TooltipEvent = Object.freeze({ type: "trigger.pressed" })

export const LEAVE_SETTLED: TooltipEvent = Object.freeze({ type: "leave.settled" })

export const POPUP_EXPANDED: TooltipEvent = Object.freeze({ type: "popup.changed", expanded: true })

export const POPUP_COLLAPSED: TooltipEvent = Object.freeze({ type: "popup.changed", expanded: false })

export const KOBALTE_OPENED: TooltipEvent = Object.freeze({ type: "kobalte.changed", open: true })

export const KOBALTE_CLOSED: TooltipEvent = Object.freeze({ type: "kobalte.changed", open: false })

export const DISPOSED_EVENT: TooltipEvent = Object.freeze({ type: "disposed" })

const PROPS = [undefined, false, true].flatMap((forceOpen) =>
  [false, true].map((disabled): TooltipEvent => Object.freeze({ type: "props.synced", forceOpen, disabled })),
)

export function syncPropsEvent(forceOpen: boolean | undefined, disabled: boolean) {
  return PROPS[(forceOpen === undefined ? 0 : forceOpen ? 4 : 2) + bit(disabled)]
}

export function createTooltipState(forceOpen: boolean | undefined, disabled: boolean): TooltipState {
  if (forceOpen === undefined) return unmounted(disabled)

  return controlled(forceOpen, false, false, disabled)
}

export function transitionTooltip(state: TooltipState, event: TooltipEvent): TooltipTransition {
  const result = next(state, event)

  if ("state" in result) return result

  return settled.get(result)!
}

/** Kobalte is mounted: the trigger owns its listeners and the popup observer runs. */
export function selectTooltipMounted(state: TooltipState) {
  return state.status !== "unmounted" && state.status !== "disposed"
}

export function selectTooltipOpen(state: TooltipState) {
  if (state.status === "open") return true

  if (state.status === "controlled") return state.open

  return false
}

export function selectTooltipForceOpen(state: TooltipState) {
  return state.status === "controlled" ? state.open : undefined
}

export function selectTooltipDismissed(state: TooltipState) {
  return state.status === "dismissed"
}

/** A popup suppresses the tooltip, so the driver reports where the pointer moves. */
export function selectTooltipTracking(state: TooltipState) {
  return state.status === "suppressed"
}

function next(state: TooltipState, event: TooltipEvent): TooltipState | TooltipTransition {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED

  if (event.type === "props.synced") return sync(state, event.forceOpen, event.disabled)

  if (state.status === "unmounted") {
    if (state.disabled) return state

    if (event.type === "pointer.entered") return REPLAY_HOVER

    if (event.type === "focused") return idle(false, false)

    return state
  }

  if (state.status === "idle") {
    if (event.type === "pointer.entered") return idle(true, state.disabled)

    if (event.type === "pointer.left") return idle(false, state.disabled)

    if (event.type === "popup.changed" && event.expanded) return popupOpen(state.hovered, state.disabled)

    if (event.type === "trigger.pressed" && state.hovered && !state.disabled) return CANCEL_OPENING

    if (event.type === "kobalte.changed" && event.open && !state.disabled) return open(state.hovered)

    return state
  }

  if (state.status === "open") {
    if (event.type === "pointer.entered") return open(true)

    if (event.type === "pointer.left") return state.hovered ? LEAVING : state

    if (event.type === "leave.settled") return state.hovered ? state : idle(false, false)

    if (event.type === "trigger.pressed") return HIDE

    if (event.type === "popup.changed" && event.expanded) return popupOpen(state.hovered, false)

    if (event.type === "kobalte.changed" && !event.open) return idle(state.hovered, false)

    return state
  }

  if (state.status === "dismissed") {
    if (event.type === "pointer.left") return idle(false, state.disabled)

    if (event.type === "focused") return idle(true, state.disabled)

    if (event.type === "popup.changed" && event.expanded) return popupOpen(true, state.disabled)

    return state
  }

  if (state.status === "suppressed") {
    if (event.type === "popup.changed" && event.expanded) {
      return popupOpen(state.popup === "closed" || state.hovered, state.disabled)
    }

    if (state.popup === "open") {
      if (event.type === "pointer.moved") return popupOpen(event.inside, state.disabled)

      if (event.type === "popup.changed") {
        return state.hovered ? popupClosed(state.disabled) : idle(false, state.disabled)
      }

      return state
    }

    if (event.type === "pointer.moved" && !event.inside) return idle(false, state.disabled)

    if (event.type === "focused") return idle(true, state.disabled)

    return state
  }

  if (event.type === "pointer.entered") return controlled(state.open, true, state.expanded, state.disabled)

  if (event.type === "pointer.left") return controlled(state.open, false, state.expanded, state.disabled)

  if (event.type === "popup.changed") return controlled(state.open, state.hovered, event.expanded, state.disabled)

  return state
}

function sync(state: TooltipState, forceOpen: boolean | undefined, disabled: boolean) {
  if (state.status === "disposed") return state

  if (forceOpen !== undefined) {
    if (state.status === "unmounted") return controlled(forceOpen, false, false, disabled)

    if (state.status === "controlled") return controlled(forceOpen, state.hovered, state.expanded, disabled)

    if (state.status === "suppressed" && state.popup === "open") {
      return controlled(forceOpen, state.hovered, true, disabled)
    }

    if (state.status === "suppressed" || state.status === "dismissed") {
      return controlled(forceOpen, true, false, disabled)
    }

    return controlled(forceOpen, state.hovered, false, disabled)
  }

  if (state.status === "unmounted") return unmounted(disabled)

  if (state.status === "idle") return idle(state.hovered, disabled)

  if (state.status === "open") return disabled ? idle(state.hovered, true) : state

  if (state.status === "dismissed") return DISMISSED[bit(disabled)]

  if (state.status === "suppressed" && state.popup === "open") return popupOpen(state.hovered, disabled)

  if (state.status === "suppressed") return popupClosed(disabled)

  // Releasing control closes the tooltip; it opens again on the next hover or focus.
  if (state.expanded) return popupOpen(state.hovered, disabled)

  return idle(state.hovered, disabled)
}
