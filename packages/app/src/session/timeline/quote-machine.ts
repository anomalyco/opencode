import type { TimelineSelection } from "./quote-text"

// A new selection waits this long without changing before the toolbar reads it.
export const QUOTE_SETTLE_MS = 150

export type QuoteRect = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export type QuoteExtent = QuoteRect & {
  readonly short: boolean
  readonly backward: boolean
}

export type QuoteHorizontal = {
  readonly left: number
  readonly right: number
  readonly origin: number
}

/** Where the toolbar can sit. `extent` is unset while the selection is scrolled out of `bounds`. */
export type QuotePlacement = {
  readonly bounds: QuoteRect
  readonly extent: QuoteExtent | undefined
}

export type ActiveQuote = {
  readonly text: string
  readonly truncated: boolean
  readonly selected: TimelineSelection
  readonly horizontal: QuoteHorizontal | undefined
  readonly placement: QuotePlacement | undefined
}

/**
 * The quote toolbar for text selected in the timeline. `pressing` is a primary press outside the toolbar that has not
 * been released: a selection made with the pointer is read only after the release. Each pending timer or frame keeps
 * the attempt it was scheduled with, and its result applies only while the state still holds that attempt.
 *
 * - `idle`: no toolbar.
 * - `shown`: the toolbar for `quote`, which stays up while a changed selection settles.
 * - `dismissed`: Escape closed the toolbar for `range`, which stays dismissed until the selection changes or clears.
 */
export type QuoteState =
  | {
      readonly status: "idle"
      readonly attempt: number
      readonly pressing: boolean
      readonly settle?: number
    }
  | {
      readonly status: "shown"
      readonly attempt: number
      readonly pressing: boolean
      readonly settle?: number
      readonly place?: number
      readonly reflow?: number
      /** A press on unselectable chrome clears `range` once the press is handled, if it is still selected. */
      readonly clear?: { readonly attempt: number; readonly range: Range }
      readonly quote: ActiveQuote
    }
  | {
      readonly status: "dismissed"
      readonly attempt: number
      readonly pressing: boolean
      readonly settle?: number
      readonly range: Range
    }

export type QuoteEvent =
  /** `collapsed`: nothing is selected as the press starts. */
  | { readonly type: "pointer.down"; readonly collapsed: boolean; readonly clearRange?: Range }
  | { readonly type: "pointer.up"; readonly collapsed: boolean }
  | { readonly type: "selection.changed"; readonly collapsed: boolean }
  | { readonly type: "settle.ready"; readonly attempt: number }
  /** The selection as read now. `dismissed`: it is still the range Escape dismissed. */
  | { readonly type: "quote.measured"; readonly quote: ActiveQuote | undefined; readonly dismissed?: boolean }
  | { readonly type: "viewport.moved" }
  | { readonly type: "place.ready"; readonly attempt: number }
  /** `collapsed`: the virtualizer removed the selected rows. */
  | { readonly type: "place.measured"; readonly collapsed: boolean; readonly placement: QuotePlacement | undefined }
  | { readonly type: "root.resized" }
  | { readonly type: "reflow.ready"; readonly attempt: number }
  | { readonly type: "clear.ready"; readonly attempt: number }
  | { readonly type: "escape"; readonly range: Range | undefined; readonly toolbarFocused: boolean }
  | { readonly type: "reset" }
  | { readonly type: "disposed" }

export type QuoteEffect =
  | { readonly type: "press.watch" }
  | { readonly type: "press.unwatch" }
  | { readonly type: "settle.schedule"; readonly attempt: number }
  | { readonly type: "settle.cancel" }
  | { readonly type: "quote.read"; readonly dismissed?: Range }
  | { readonly type: "place.schedule"; readonly attempt: number }
  | { readonly type: "place.cancel" }
  | { readonly type: "place.measure"; readonly quote: ActiveQuote }
  | { readonly type: "reflow.schedule"; readonly attempt: number }
  | { readonly type: "reflow.cancel" }
  | { readonly type: "clear.schedule"; readonly attempt: number }
  | { readonly type: "clear.cancel" }
  | { readonly type: "selection.clearIfSame"; readonly range: Range }
  | { readonly type: "focus.root" }

export type QuoteTransition = {
  readonly state: QuoteState
  readonly effects: readonly QuoteEffect[]
}

// Shared events for the frequent dispatches, so scrolling and resizing allocate nothing.
export const VIEWPORT_MOVED_QUOTE_EVENT: QuoteEvent = Object.freeze({ type: "viewport.moved" })

export const ROOT_RESIZED_QUOTE_EVENT: QuoteEvent = Object.freeze({ type: "root.resized" })

export const SELECTION_CHANGED_QUOTE_EVENT: QuoteEvent = Object.freeze({ type: "selection.changed", collapsed: false })

export const SELECTION_CLEARED_QUOTE_EVENT: QuoteEvent = Object.freeze({ type: "selection.changed", collapsed: true })

export const RESET_QUOTE_EVENT: QuoteEvent = Object.freeze({ type: "reset" })

export const DISPOSED_QUOTE_EVENT: QuoteEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly QuoteEffect[] = Object.freeze([])

const PRESS_WATCH: QuoteEffect = Object.freeze({ type: "press.watch" })

const PRESS_UNWATCH: QuoteEffect = Object.freeze({ type: "press.unwatch" })

const SETTLE_CANCEL: QuoteEffect = Object.freeze({ type: "settle.cancel" })

const PLACE_CANCEL: QuoteEffect = Object.freeze({ type: "place.cancel" })

const REFLOW_CANCEL: QuoteEffect = Object.freeze({ type: "reflow.cancel" })

const CLEAR_CANCEL: QuoteEffect = Object.freeze({ type: "clear.cancel" })

const QUOTE_READ: QuoteEffect = Object.freeze({ type: "quote.read" })

const FOCUS_ROOT: QuoteEffect = Object.freeze({ type: "focus.root" })

export function createQuoteState(): QuoteState {
  return { status: "idle", attempt: 0, pressing: false }
}

export function transitionQuote(state: QuoteState, event: QuoteEvent): QuoteTransition {
  if (event.type === "reset" || event.type === "disposed") {
    if (state.status === "idle" && !state.pressing && state.settle === undefined) return unchanged(state)

    return idle(state, false)
  }

  if (event.type === "pointer.down") {
    const attempt = state.attempt + 1
    const clear = state.status === "shown" && event.clearRange ? { attempt, range: event.clearRange } : undefined

    // A press ends any settling selection: the release reads it again. A press that finds nothing selected also ends a
    // dismissal, as Chrome can coalesce the clear's selectionchange with those of the next drag, which may select the
    // dismissed range again.
    return {
      state:
        state.status === "shown"
          ? { ...state, attempt, pressing: true, settle: undefined, clear }
          : state.status === "dismissed" && event.collapsed
            ? { status: "idle", attempt, pressing: true }
            : { ...state, attempt, pressing: true, settle: undefined },
      effects: [
        ...(state.settle !== undefined ? [SETTLE_CANCEL] : NO_EFFECTS),
        ...(state.status === "shown" && state.clear ? [CLEAR_CANCEL] : NO_EFFECTS),
        ...(state.pressing ? NO_EFFECTS : [PRESS_WATCH]),
        ...(clear ? [{ type: "clear.schedule" as const, attempt }] : NO_EFFECTS),
      ],
    }
  }

  if (event.type === "pointer.up") {
    if (!state.pressing) return unchanged(state)

    if (event.collapsed) return idle(state, false)

    return settle({ ...state, pressing: false }, [PRESS_UNWATCH])
  }

  if (event.type === "selection.changed") {
    // A cleared selection closes at once, even mid-press.
    if (event.collapsed) {
      if (state.status === "idle" && state.settle === undefined) return unchanged(state)

      return idle(state, true)
    }

    // A selection still being made with the pointer is read once it is released.
    if (state.pressing) {
      if (state.status !== "shown" || !state.clear) return unchanged(state)

      return { state: { ...state, clear: undefined }, effects: [CLEAR_CANCEL] }
    }

    return settle(state, NO_EFFECTS)
  }

  if (event.type === "settle.ready") {
    if (state.settle !== event.attempt || state.pressing) return unchanged(state)

    return {
      state: { ...state, settle: undefined },
      effects: [state.status === "dismissed" ? { type: "quote.read", dismissed: state.range } : QUOTE_READ],
    }
  }

  if (event.type === "quote.measured") {
    if (event.dismissed && state.status === "dismissed") return unchanged(state)

    if (!event.quote) return idle(state, true)

    return {
      state: {
        status: "shown",
        attempt: state.attempt + 1,
        pressing: state.pressing,
        settle: state.settle,
        quote: event.quote,
      },
      effects: state.status === "shown" ? handles(state, { place: true, reflow: true, clear: true }) : NO_EFFECTS,
    }
  }

  if (event.type === "escape") {
    if (state.status !== "shown") return unchanged(state)

    const effects = [
      ...handles(state, { settle: true, place: true, reflow: true, clear: true }),
      ...(event.toolbarFocused ? [FOCUS_ROOT] : NO_EFFECTS),
    ]

    if (!event.range)
      return { state: { status: "idle", attempt: state.attempt + 1, pressing: state.pressing }, effects }

    return {
      state: { status: "dismissed", attempt: state.attempt + 1, pressing: state.pressing, range: event.range },
      effects,
    }
  }

  if (state.status !== "shown") return unchanged(state)

  if (event.type === "viewport.moved") {
    if (state.place !== undefined) return unchanged(state)

    return { state: { ...state, place: state.attempt }, effects: [{ type: "place.schedule", attempt: state.attempt }] }
  }

  if (event.type === "place.ready") {
    if (state.place !== event.attempt) return unchanged(state)

    return { state: { ...state, place: undefined }, effects: [{ type: "place.measure", quote: state.quote }] }
  }

  if (event.type === "place.measured") {
    if (event.collapsed) return idle(state, true)

    return { state: { ...state, quote: { ...state.quote, placement: event.placement } }, effects: NO_EFFECTS }
  }

  // A resize reflows the selected text, so the quote is read again once the press, if any, is released.
  if (event.type === "root.resized") {
    if (state.reflow !== undefined || state.pressing) return unchanged(state)

    return {
      state: { ...state, reflow: state.attempt },
      effects: [{ type: "reflow.schedule", attempt: state.attempt }],
    }
  }

  if (event.type === "reflow.ready") {
    if (state.reflow !== event.attempt) return unchanged(state)

    return { state: { ...state, reflow: undefined }, effects: state.pressing ? NO_EFFECTS : [QUOTE_READ] }
  }

  if (state.clear?.attempt !== event.attempt) return unchanged(state)

  return {
    state: { ...state, clear: undefined },
    effects: [{ type: "selection.clearIfSame", range: state.clear.range }],
  }
}

export function activeQuote(state: QuoteState) {
  return state.status === "shown" ? state.quote : undefined
}

/** The toolbar's content and placement, while the selection is in view. */
export function quoteToolbarView(state: QuoteState) {
  if (state.status !== "shown" || !state.quote.placement?.extent) return undefined

  return {
    text: state.quote.text,
    truncated: state.quote.truncated,
    bounds: state.quote.placement.bounds,
    extent: state.quote.placement.extent,
  }
}

export function isQuotePressing(state: QuoteState) {
  return state.pressing
}

export function canScheduleQuotePlace(state: QuoteState) {
  return state.status === "shown" && state.place === undefined
}

export function canScheduleQuoteReflow(state: QuoteState) {
  return state.status === "shown" && state.reflow === undefined && !state.pressing
}

// Leaving the toolbar cancels every timer and frame it scheduled; `keepPress` keeps watching a press in progress.
function idle(state: QuoteState, keepPress: boolean): QuoteTransition {
  const pressing = keepPress && state.pressing

  return {
    state: { status: "idle", attempt: state.attempt + 1, pressing },
    effects: [
      ...handles(state, { settle: true, place: true, reflow: true, clear: true }),
      ...(state.pressing && !pressing ? [PRESS_UNWATCH] : NO_EFFECTS),
    ],
  }
}

// A selection that changed waits to settle before it is read again; an open toolbar stays meanwhile.
function settle(state: QuoteState, effects: readonly QuoteEffect[]): QuoteTransition {
  const attempt = state.attempt + 1

  return {
    state: { ...state, attempt, settle: attempt },
    effects: [
      ...effects,
      ...(state.settle !== undefined ? [SETTLE_CANCEL] : NO_EFFECTS),
      { type: "settle.schedule", attempt },
    ],
  }
}

function handles(
  state: QuoteState,
  which: { settle?: boolean; place?: boolean; reflow?: boolean; clear?: boolean },
): QuoteEffect[] {
  return [
    ...(which.settle && state.settle !== undefined ? [SETTLE_CANCEL] : NO_EFFECTS),
    ...(which.place && state.status === "shown" && state.place !== undefined ? [PLACE_CANCEL] : NO_EFFECTS),
    ...(which.reflow && state.status === "shown" && state.reflow !== undefined ? [REFLOW_CANCEL] : NO_EFFECTS),
    ...(which.clear && state.status === "shown" && state.clear ? [CLEAR_CANCEL] : NO_EFFECTS),
  ]
}

function unchanged(state: QuoteState): QuoteTransition {
  return { state, effects: NO_EFFECTS }
}
