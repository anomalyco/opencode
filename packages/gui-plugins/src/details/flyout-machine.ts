/** How long a pointer may rest inside the safe triangle before the row under it takes over. */
export const AIM_TIMEOUT_MS = 100

export type Service = "mcp" | "plugins" | "skills"

/** Where the trigger row sits in the flyout's containing block, and the room around it in the viewport. */
export type FlyoutAnchor = { readonly row: number; readonly above: number; readonly below: number }

/**
 * The Extensions flyout beside the details popover. Each aim at another row takes the next attempt number, so an aim
 * timer whose attempt the state no longer holds is stale; `issued` is the last one handed out.
 */
export type FlyoutState =
  /** No list shows. `pane` is the last list, kept through the exit so it fades out with its content. */
  | {
      readonly status: "closed"
      readonly pane: Service | undefined
      readonly anchor: FlyoutAnchor
      readonly issued: number
    }
  /** `refreshed` lists the lists refreshed since the flyout opened, each the first time it showed. */
  | {
      readonly status: "open"
      readonly service: Service
      readonly anchor: FlyoutAnchor
      readonly refreshed: readonly Service[]
      readonly issued: number
    }
  /** The pointer heads for the open list across another row; `target` takes over once the pointer rests. */
  | {
      readonly status: "aiming"
      readonly service: Service
      readonly target: Service
      readonly attempt: number
      readonly anchor: FlyoutAnchor
      readonly refreshed: readonly Service[]
    }
  | { readonly status: "disposed" }

export type FlyoutEvent =
  /** The pointer entered a row: opens a closed flyout. `anchor` is undefined when the row could not be measured. */
  | {
      readonly type: "row.entered"
      readonly service: Service
      readonly shown: boolean
      readonly anchor: FlyoutAnchor | undefined
    }
  /** A click or the inline-end arrow key on a row opens its list; `focus` moves focus into it. */
  | {
      readonly type: "row.activated"
      readonly service: Service
      readonly focus: boolean
      readonly shown: boolean
      readonly anchor: FlyoutAnchor | undefined
    }
  /**
   * The pointer moved over the rows, or focus moved to another row: switches an open flyout. `service` is undefined
   * between rows; `aiming` is whether the pointer heads for the open list. `anchor` is only measured for a switch.
   */
  | {
      readonly type: "row.moved"
      readonly service: Service | undefined
      readonly aiming: boolean
      readonly anchor: FlyoutAnchor | undefined
    }
  /** The pointer left the rows or reached the flyout. */
  | { readonly type: "aim.cancelled" }
  | { readonly type: "aim.due"; readonly attempt: number; readonly anchor: FlyoutAnchor | undefined }
  /** Scrolling or resizing measured the open row again. */
  | { readonly type: "remeasured"; readonly anchor: FlyoutAnchor | undefined }
  /** Escape, the inline-start arrow key or a footer action; `focusRow` returns focus from the list to its row. */
  | { readonly type: "close"; readonly focusRow: boolean }
  /** The details popover or drawer hid. */
  | { readonly type: "hidden" }
  | { readonly type: "disposed" }

export type FlyoutEffect =
  /** Starts the aim timer again; it reports `aim.due` with the target row measured. */
  | { readonly type: "schedule-aim"; readonly attempt: number; readonly target: Service; readonly delayMs: number }
  | { readonly type: "cancel-aim" }
  /** The first open lands beside its row at its list's height without a transition; later switches glide. */
  | { readonly type: "snap-open" }
  | { readonly type: "refresh"; readonly service: Service }
  | { readonly type: "focus-pane"; readonly service: Service }
  /** Runs before the state commits, so focus leaves the list before it goes inert. */
  | { readonly type: "focus-row"; readonly service: Service }

export type FlyoutTransition = { readonly state: FlyoutState; readonly effects: readonly FlyoutEffect[] }

const NO_ANCHOR: FlyoutAnchor = { row: 0, above: 0, below: 0 }

export const initialFlyoutState: FlyoutState = { status: "closed", pane: undefined, anchor: NO_ANCHOR, issued: 0 }

const NONE: readonly FlyoutEffect[] = []

const CANCEL_AIM: readonly FlyoutEffect[] = [{ type: "cancel-aim" }]

type Opened = Extract<FlyoutState, { status: "open" | "aiming" }>

export function transitionFlyout(state: FlyoutState, event: FlyoutEvent): FlyoutTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: state.status === "aiming" ? CANCEL_AIM : NONE }

  if (state.status === "closed") return opening(state, event)

  if (event.type === "hidden") return close(state, NONE)

  if (event.type === "close")
    return close(state, event.focusRow ? [{ type: "focus-row", service: state.service }] : NONE)

  if (event.type === "aim.cancelled") return settle(state)

  if (event.type === "remeasured") {
    if (!event.anchor || sameAnchor(state.anchor, event.anchor)) return { state, effects: NONE }

    return { state: { ...state, anchor: event.anchor }, effects: NONE }
  }

  if (event.type === "aim.due") {
    if (state.status !== "aiming" || event.attempt !== state.attempt) return { state, effects: NONE }

    return event.anchor ? show(state, state.target, event.anchor, false) : settle(state)
  }

  if (event.type === "row.entered") return { state, effects: NONE }

  if (event.type === "row.activated") {
    if (!event.shown || !event.anchor) return settle(state)

    return show(state, event.service, event.anchor, event.focus)
  }

  if (!event.service || event.service === state.service) return settle(state)

  if (event.aiming) return aim(state, event.service)

  return event.anchor ? show(state, event.service, event.anchor, false) : settle(state)
}

/** The open flyout, or undefined while it is closed. */
export function flyoutActive(state: FlyoutState) {
  return state.status === "open" || state.status === "aiming" ? state.service : undefined
}

/** The list on show, kept while the flyout fades out. */
export function flyoutPane(state: FlyoutState) {
  if (state.status === "disposed") return undefined

  return state.status === "closed" ? state.pane : state.service
}

export function flyoutAnchor(state: FlyoutState) {
  return state.status === "disposed" ? NO_ANCHOR : state.anchor
}

export function sameAnchor(a: FlyoutAnchor, b: FlyoutAnchor) {
  return a.row === b.row && a.above === b.above && a.below === b.below
}

function opening(state: Extract<FlyoutState, { status: "closed" }>, event: FlyoutEvent): FlyoutTransition {
  if (event.type !== "row.entered" && event.type !== "row.activated") return { state, effects: NONE }

  if (!event.shown || !event.anchor) return { state, effects: NONE }
  const focus = event.type === "row.activated" && event.focus

  return {
    state: {
      status: "open",
      service: event.service,
      anchor: event.anchor,
      refreshed: [event.service],
      issued: state.issued,
    },
    effects: [
      { type: "refresh", service: event.service },
      { type: "snap-open" },
      ...(focus ? [{ type: "focus-pane", service: event.service } as const] : []),
    ],
  }
}

function show(state: Opened, service: Service, anchor: FlyoutAnchor, focus: boolean): FlyoutTransition {
  const fresh = !state.refreshed.includes(service)

  const effects: readonly FlyoutEffect[] = [
    ...(state.status === "aiming" ? CANCEL_AIM : NONE),
    ...(fresh ? [{ type: "refresh", service } as const] : []),
    ...(focus ? [{ type: "focus-pane", service } as const] : []),
  ]

  if (state.status === "open" && state.service === service && sameAnchor(state.anchor, anchor))
    return { state, effects }

  return {
    state: {
      status: "open",
      service,
      anchor,
      refreshed: fresh ? [...state.refreshed, service] : state.refreshed,
      issued: issued(state),
    },
    effects,
  }
}

// Each move keeps the pointer's aim alive for another timeout; a new target takes a new attempt.
function aim(state: Opened, target: Service): FlyoutTransition {
  if (state.status === "aiming" && state.target === target)
    return { state, effects: [{ type: "schedule-aim", attempt: state.attempt, target, delayMs: AIM_TIMEOUT_MS }] }
  const attempt = issued(state) + 1

  return {
    state: {
      status: "aiming",
      service: state.service,
      target,
      attempt,
      anchor: state.anchor,
      refreshed: state.refreshed,
    },
    effects: [{ type: "schedule-aim", attempt, target, delayMs: AIM_TIMEOUT_MS }],
  }
}

// The pointer gave up its aim: the list on show stays.
function settle(state: Opened): FlyoutTransition {
  if (state.status === "open") return { state, effects: NONE }

  return {
    state: {
      status: "open",
      service: state.service,
      anchor: state.anchor,
      refreshed: state.refreshed,
      issued: state.attempt,
    },
    effects: CANCEL_AIM,
  }
}

function close(state: Opened, effects: readonly FlyoutEffect[]): FlyoutTransition {
  return {
    state: { status: "closed", pane: state.service, anchor: state.anchor, issued: issued(state) },
    effects: [...(state.status === "aiming" ? CANCEL_AIM : NONE), ...effects],
  }
}

function issued(state: Opened) {
  return state.status === "aiming" ? state.attempt : state.issued
}
