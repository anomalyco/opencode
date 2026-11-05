/** How the details popover opened: a pointer focuses the popover itself, the keyboard its first row. */
export type DetailsPopoverVia = "pointer" | "keyboard"

/**
 * One session header's details popover. Each open takes the next attempt number from `issued`, so a deferred focus
 * whose attempt the state no longer holds is stale.
 */
export type DetailsPopoverState =
  | { readonly status: "closed"; readonly issued: number }
  | {
      readonly status: "open"
      readonly issued: number
      readonly attempt: number
      readonly via: DetailsPopoverVia
      /** A pointer open's focus of the popover waits for the content to be in the document. */
      readonly focusPending: boolean
    }
  | { readonly status: "disposed" }

export type DetailsPopoverEvent =
  /** The trigger opened the popover. */
  | { readonly type: "opened"; readonly via: DetailsPopoverVia }
  /** The shortcut toggled the popover. */
  | { readonly type: "toggled"; readonly via: DetailsPopoverVia }
  /** Escape, an outside press, the trigger, an action in the popover, or the end of the session's visit. */
  | { readonly type: "closed" }
  /** The popover content is about to focus its first row. */
  | { readonly type: "autofocus.intercepted" }
  | { readonly type: "focus.due"; readonly attempt: number }
  | { readonly type: "disposed" }

export type DetailsPopoverEffect =
  | { readonly type: "schedule-focus"; readonly attempt: number }
  | { readonly type: "cancel-focus" }
  | { readonly type: "focus-content" }

export type DetailsPopoverTransition = {
  readonly state: DetailsPopoverState
  readonly effects: readonly DetailsPopoverEffect[]
}

export const initialDetailsPopoverState: DetailsPopoverState = { status: "closed", issued: 0 }

const NONE: readonly DetailsPopoverEffect[] = []

const CANCEL_FOCUS: readonly DetailsPopoverEffect[] = [{ type: "cancel-focus" }]

const FOCUS_CONTENT: readonly DetailsPopoverEffect[] = [{ type: "focus-content" }]

export function transitionDetailsPopover(
  state: DetailsPopoverState,
  event: DetailsPopoverEvent,
): DetailsPopoverTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: state.status === "open" && state.focusPending ? CANCEL_FOCUS : NONE,
    }

  if (state.status === "closed") {
    if (event.type !== "opened" && event.type !== "toggled") return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: { status: "open", issued: attempt, attempt, via: event.via, focusPending: false },
      effects: NONE,
    }
  }

  if (event.type === "closed" || event.type === "toggled")
    return { state: { status: "closed", issued: state.issued }, effects: state.focusPending ? CANCEL_FOCUS : NONE }

  if (event.type === "autofocus.intercepted") {
    if (state.via !== "pointer" || state.focusPending) return { state, effects: NONE }

    return {
      state: { ...state, focusPending: true },
      effects: [{ type: "schedule-focus", attempt: state.attempt }],
    }
  }

  if (event.type === "focus.due" && state.focusPending && event.attempt === state.attempt)
    return { state: { ...state, focusPending: false }, effects: FOCUS_CONTENT }

  return { state, effects: NONE }
}

export function detailsPopoverOpen(state: DetailsPopoverState) {
  return state.status === "open"
}

/** Whether the popover focuses itself instead of its first row, so a pointer open shows no focus ring on a row. */
export function detailsPopoverFocusesContent(state: DetailsPopoverState) {
  return state.status === "open" && state.via === "pointer"
}
