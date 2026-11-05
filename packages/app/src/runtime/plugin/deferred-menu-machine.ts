/** How long a chosen item waits for the closing menu to return focus before it runs anyway. */
export const DEFERRED_MENU_FALLBACK_MS = 50

/** What a press on a dual trigger asks for: its menu, or the trigger's own action (a new tab). */
export type DeferredMenuIntent = "menu" | "new"

/**
 * A menu whose chosen item runs only once the closing menu has returned focus to its trigger, so the item can move
 * focus where it needs it without the trigger or tab strip taking it back.
 */
export type DeferredMenuState<T> =
  /** `armed`: what the press under way asked for, read when the menu reports it opens; cleared once read. */
  | {
      readonly status: "closed"
      readonly attempt: number
      readonly hover: boolean
      readonly armed: DeferredMenuIntent | undefined
    }
  | { readonly status: "open"; readonly attempt: number; readonly hover: boolean }
  /** An item was chosen and runs once focus returns, or after the fallback. `attempt` names its timer. */
  | { readonly status: "closing"; readonly attempt: number; readonly hover: boolean; readonly choice: T }
  | { readonly status: "disposed" }

export type DeferredMenuEvent<T> =
  | { readonly type: "hover"; readonly hover: boolean }
  | { readonly type: "arm"; readonly intent: DeferredMenuIntent }
  | { readonly type: "disarm" }
  /** `available`: the menu has something to list. */
  | { readonly type: "context.menu"; readonly available: boolean }
  /** The menu asks to open or close; an open with nothing armed does `defaultIntent`. */
  | {
      readonly type: "open.change"
      readonly open: boolean
      readonly available: boolean
      readonly defaultIntent: DeferredMenuIntent
    }
  | { readonly type: "select"; readonly choice: T }
  /** The closing menu returned focus to its trigger. */
  | { readonly type: "close.autofocus" }
  | { readonly type: "timer.fired"; readonly attempt: number }
  | { readonly type: "disposed" }

export type DeferredMenuEffect<T> =
  | { readonly type: "open.new-tab" }
  | { readonly type: "timer.start"; readonly attempt: number; readonly delay: number }
  | { readonly type: "timer.stop" }
  | { readonly type: "run.choice"; readonly choice: T }

export type DeferredMenuTransition<T> = {
  readonly state: DeferredMenuState<T>
  readonly effects: readonly DeferredMenuEffect<T>[]
}

export function createDeferredMenuState<T>(): DeferredMenuState<T> {
  return { status: "closed", attempt: 0, hover: false, armed: undefined }
}

export function transitionDeferredMenu<T>(
  state: DeferredMenuState<T>,
  event: DeferredMenuEvent<T>,
): DeferredMenuTransition<T> {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: state.status === "closing" ? [{ type: "timer.stop" }] : [] }

  if (event.type === "hover") {
    if (state.status !== "closed") return { state: state.hover === event.hover ? state : { ...state, hover: event.hover }, effects: [] }

    // A press that leaves the trigger is abandoned.
    const armed = event.hover ? state.armed : undefined

    if (state.hover === event.hover && state.armed === armed) return { state, effects: [] }

    return { state: { ...state, hover: event.hover, armed }, effects: [] }
  }

  if (state.status === "closed") return closed(state, event)

  if (state.status === "open") {
    if (event.type === "open.change" && !event.open) return { state: closedState(state.attempt, state.hover), effects: [] }

    if (event.type === "select") return choose(state.attempt, state.hover, event.choice)

    return { state, effects: [] }
  }

  if (event.type === "select") return choose(state.attempt, state.hover, event.choice)

  if (event.type === "close.autofocus")
    return { state, effects: [{ type: "timer.start", attempt: state.attempt, delay: 0 }] }

  if (event.type === "timer.fired" && event.attempt === state.attempt)
    return { state: closedState(state.attempt, state.hover), effects: [{ type: "run.choice", choice: state.choice }] }

  // Reopened before the choice ran: run it now rather than lose it.
  if ((event.type === "context.menu" || (event.type === "open.change" && event.open)) && event.available)
    return {
      state: { status: "open", attempt: state.attempt + 1, hover: state.hover },
      effects: [{ type: "timer.stop" }, { type: "run.choice", choice: state.choice }],
    }

  return { state, effects: [] }
}

export function selectDeferredMenuOpen<T>(state: DeferredMenuState<T>) {
  return state.status === "open"
}

export function selectDeferredMenuHover<T>(state: DeferredMenuState<T>) {
  return state.status !== "disposed" && state.hover
}

function closed<T>(
  state: Extract<DeferredMenuState<T>, { status: "closed" }>,
  event: DeferredMenuEvent<T>,
): DeferredMenuTransition<T> {
  if (event.type === "arm")
    return { state: state.armed === event.intent ? state : { ...state, armed: event.intent }, effects: [] }

  if (event.type === "disarm" || (event.type === "open.change" && !event.open) || (event.type === "context.menu" && !event.available))
    return { state: state.armed === undefined ? state : { ...state, armed: undefined }, effects: [] }

  if (event.type === "context.menu") return { state: { status: "open", attempt: state.attempt, hover: state.hover }, effects: [] }

  if (event.type !== "open.change") return { state, effects: [] }

  if ((state.armed ?? event.defaultIntent) === "menu" && event.available)
    return { state: { status: "open", attempt: state.attempt, hover: state.hover }, effects: [] }

  return { state: closedState(state.attempt, state.hover), effects: [{ type: "open.new-tab" }] }
}

function choose<T>(attempt: number, hover: boolean, choice: T): DeferredMenuTransition<T> {
  return {
    state: { status: "closing", attempt: attempt + 1, hover, choice },
    effects: [{ type: "timer.start", attempt: attempt + 1, delay: DEFERRED_MENU_FALLBACK_MS }],
  }
}

function closedState<T>(attempt: number, hover: boolean): DeferredMenuState<T> {
  return { status: "closed", attempt, hover, armed: undefined }
}
