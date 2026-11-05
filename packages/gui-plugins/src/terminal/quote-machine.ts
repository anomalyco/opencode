/** How long the selection must stay unchanged before the toolbar reads it. */
export const TERMINAL_QUOTE_SETTLE_MS = 150

/** Space between the toolbar, the selection and the terminal's edges. */
export const TERMINAL_QUOTE_GAP = 8

/** Matches the timeline's limit, so a quote never carries more than one from the conversation could. */
export const TERMINAL_QUOTE_MAX_LENGTH = 20_000

export type QuotePlace = { readonly top: number; readonly left: number }

export type QuoteSize = { readonly width: number; readonly height: number }

export type QuoteRect = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

/** The selection in terminal cells, relative to the viewport. */
export type QuoteCells = {
  readonly start: { readonly x: number; readonly y: number }
  readonly end: { readonly x: number; readonly y: number }
}

/** The selection's box in viewport pixels. */
export type QuoteAnchor = {
  readonly top: number
  readonly bottom: number
  readonly start: number
  readonly end: number
  readonly single: boolean
}

export type QuotePlacement = { readonly bounds: QuoteRect; readonly anchor: QuoteAnchor }

/**
 * Where the quoted text lived when it was read. A later PTY write (`written`) or grid resize (`resized`) can move or
 * evict those rows, so either one invalidates the cells and the composer falls back to its quote tile.
 */
export type QuoteSource = {
  readonly cells: QuoteCells | undefined
  /** Rows between the viewport and the end of the scrollback. */
  readonly offset: number
  readonly written: number
  readonly resized: number
}

/** The terminal's geometry, read in one frame while it has a selection. */
export type QuoteSample = {
  readonly cells: QuoteCells | undefined
  readonly offset: number
  readonly written: number
  readonly bounds: QuoteRect
  /** The canvas's top-left corner; undefined before the renderer has a canvas. */
  readonly origin: { readonly top: number; readonly left: number } | undefined
  /** One cell's size; undefined before the renderer has measured the font. */
  readonly metrics: { readonly width: number; readonly height: number } | undefined
}

type Shared = {
  /** Last attempt id handed to a settle timer or placement frame. */
  readonly issued: number
  /** Ticks on every scroll and resize, so a quote's retained anchor follows the terminal. */
  readonly revision: number
  /** Ticks on every grid resize, which invalidates captured cells. */
  readonly resized: number
}

/**
 * `pressing` holds while the primary button is down outside the toolbar; selection reads wait for the release.
 * `settling` waits `TERMINAL_QUOTE_SETTLE_MS` under `attempt` before reading the selection. `shown` offers the quote;
 * `placement` is undefined while the selection is out of view, and `placeAttempt` names the queued placement frame.
 */
export type QuoteState =
  | (Shared & { readonly status: "idle" })
  | (Shared & { readonly status: "pressing" })
  | (Shared & { readonly status: "settling"; readonly attempt: number })
  | (Shared & {
      readonly status: "shown"
      readonly text: string
      readonly truncated: boolean
      readonly source: QuoteSource
      readonly placement: QuotePlacement | undefined
      /** Zero until the toolbar is measured for this selection. */
      readonly toolbarSize: QuoteSize
      readonly placeAttempt: number | undefined
    })
  | { readonly status: "disposed" }

export type QuoteEvent =
  /** A press outside the toolbar; only the primary button (`0`) starts a selection gesture. */
  | { readonly type: "pointer.down"; readonly button: number }
  /** `pointerup`, `pointercancel`, `contextmenu` or window `blur`: the press ended. */
  | { readonly type: "pointer.released" }
  | { readonly type: "selection.changed" }
  /** The settle timer fired; `sample` is undefined when the terminal has no selection. */
  | {
      readonly type: "settle.sampled"
      readonly attempt: number
      /** The selected text, empty without a selection. */
      readonly text: string
      readonly sample: QuoteSample | undefined
    }
  | { readonly type: "key.pressed"; readonly key: string; readonly modified: boolean }
  /** A scroll or resize; `resized` is true only for a grid resize. */
  | { readonly type: "layout.changed"; readonly resized: boolean }
  /** The placement frame ran; `sample` is undefined when the terminal has no selection. */
  | { readonly type: "place.sampled"; readonly attempt: number; readonly sample: QuoteSample | undefined }
  | { readonly type: "toolbar.measured"; readonly size: QuoteSize }
  /** The user clicked Quote; with Alt, without a comment anchor. */
  | { readonly type: "quote.added"; readonly skipComment: boolean }
  | { readonly type: "disposed" }

export type QuoteEffect =
  | { readonly type: "schedule-settle"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-settle" }
  | { readonly type: "schedule-place"; readonly attempt: number }
  | { readonly type: "cancel-place" }
  | { readonly type: "clear-selection" }
  /** Adds the quote to the composer; `source` is undefined when it carries no comment anchor. */
  | { readonly type: "commit-quote"; readonly text: string; readonly source: QuoteSource | undefined }

export type QuoteTransition = { readonly state: QuoteState; readonly effects: readonly QuoteEffect[] }

const NONE: readonly never[] = []

const CANCEL_SETTLE: readonly QuoteEffect[] = [{ type: "cancel-settle" }]

const CANCEL_PLACE: readonly QuoteEffect[] = [{ type: "cancel-place" }]

const UNMEASURED: QuoteSize = { width: 0, height: 0 }

/** A fresh state per toolbar. */
export function createQuoteState(): QuoteState {
  return { status: "idle", issued: 0, revision: 0, resized: 0 }
}

/**
 * ghostty-web announces a finished selection but clears one without an event (on a press, or while typing), so a
 * press, a key and a sample without a selection all close the toolbar.
 */
export function transitionQuote(state: QuoteState, event: QuoteEvent): QuoteTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cancel(state) }

  if (event.type === "layout.changed") return layout(state, event.resized)

  if (event.type === "pointer.down") {
    // A secondary press (a context menu) neither selects nor clears the selection.
    if (event.button !== 0 || state.status === "pressing") return { state, effects: NONE }

    return { state: shared(state, "pressing"), effects: cancel(state) }
  }

  if (event.type === "pointer.released") {
    if (state.status !== "pressing") return { state, effects: NONE }

    return settle(state, NONE)
  }

  if (event.type === "selection.changed") {
    // The drag is still going; the release reads the selection.
    if (state.status === "pressing") return { state, effects: NONE }

    return settle(state, state.status === "shown" ? cancel(state) : NONE)
  }

  if (event.type === "settle.sampled") {
    if (state.status !== "settling" || state.attempt !== event.attempt) return { state, effects: NONE }

    // Output keeps trailing blank rows a drag past the last line picks up.
    const text = event.text.replace(/^\n+|\s+$/g, "")

    if (!event.sample || !text) return { state: shared(state, "idle"), effects: NONE }

    return {
      state: {
        status: "shown",
        issued: state.issued,
        revision: state.revision,
        resized: state.resized,
        text,
        truncated: text.length > TERMINAL_QUOTE_MAX_LENGTH,
        source: {
          cells: event.sample.cells,
          offset: event.sample.offset,
          written: event.sample.written,
          resized: state.resized,
        },
        placement: quotePlacement(event.sample),
        toolbarSize: UNMEASURED,
        placeAttempt: undefined,
      },
      effects: NONE,
    }
  }

  if (event.type === "key.pressed") {
    if (event.modified || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return { state, effects: NONE }

    if (state.status !== "settling" && state.status !== "shown") return { state, effects: NONE }

    return { state: shared(state, "idle"), effects: cancel(state) }
  }

  if (state.status !== "shown") return { state, effects: NONE }

  if (event.type === "place.sampled") {
    if (state.placeAttempt !== event.attempt) return { state, effects: NONE }

    if (!event.sample) return { state: shared(state, "idle"), effects: NONE }

    return { state: { ...state, placeAttempt: undefined, ...placed(state, event.sample) }, effects: NONE }
  }

  if (event.type === "toolbar.measured") {
    if (event.size.width === state.toolbarSize.width && event.size.height === state.toolbarSize.height)
      return { state, effects: NONE }

    return { state: { ...state, toolbarSize: event.size }, effects: NONE }
  }

  if (state.truncated) return { state, effects: NONE }

  return {
    state: shared(state, "idle"),
    effects: [
      ...cancel(state),
      { type: "clear-selection" },
      { type: "commit-quote", text: state.text, source: event.skipComment ? undefined : state.source },
    ],
  }
}

/** The toolbar's position, or undefined while it is hidden. `measured` is false until its size is known. */
export function selectQuoteToolbar(state: QuoteState, available: boolean) {
  if (state.status !== "shown" || !available || !state.placement) return

  return {
    place: quotePosition(state.toolbarSize, state.placement.bounds, state.placement.anchor),
    measured: state.toolbarSize.height !== 0,
    truncated: state.truncated,
  }
}

/**
 * Where a quote's comment editor goes, next to the rows the quote came from, followed through scrolling. Undefined
 * once the toolbar is disposed, when the rows moved (a write or grid resize since the read), or while the terminal is
 * hidden; the composer then falls back to the quote tile.
 */
export function selectQuoteSourcePlace(
  state: QuoteState,
  source: QuoteSource,
  size: QuoteSize,
  /** Reads the terminal's geometry; called only while the source still holds. */
  measure: () => Omit<QuoteSample, "cells">,
) {
  if (state.status === "disposed" || !source.cells || source.resized !== state.resized) return
  const input = measure()

  // Ghostty has no stable line identity: a write can evict history even while its retained length grows.
  if (source.written !== input.written) return

  if (!input.bounds.width || !input.bounds.height || !input.origin || !input.metrics) return
  const rows = source.offset - input.offset

  const cells = {
    start: { x: source.cells.start.x, y: source.cells.start.y + rows },
    end: { x: source.cells.end.x, y: source.cells.end.y + rows },
  }

  return quotePosition(size, input.bounds, anchorOf(cells, input.origin, input.metrics))
}

/** A one-line selection gets the toolbar above; a taller one below its end, where the drag usually stops. */
export function quotePosition(size: QuoteSize, bounds: QuoteRect, anchor: QuoteAnchor): QuotePlace {
  const above = anchor.top - size.height - TERMINAL_QUOTE_GAP
  const below = anchor.bottom + TERMINAL_QUOTE_GAP
  const fitsAbove = above >= bounds.top + TERMINAL_QUOTE_GAP && anchor.top <= bounds.bottom
  const fitsBelow = below + size.height <= bounds.bottom - TERMINAL_QUOTE_GAP && anchor.bottom >= bounds.top
  const sides = anchor.single ? [fitsAbove && above, fitsBelow && below] : [fitsBelow && below, fitsAbove && above]
  const top = sides.find((side) => side !== false)
  const center = anchor.single ? (anchor.start + anchor.end - size.width) / 2 : anchor.end - size.width / 2
  const min = bounds.left + TERMINAL_QUOTE_GAP

  return {
    top: top ?? bounds.bottom - size.height - TERMINAL_QUOTE_GAP,
    // A pane narrower than the toolbar pins it to the left edge instead of past it.
    left: Math.max(min, Math.min(center, bounds.right - size.width - TERMINAL_QUOTE_GAP)),
  }
}

/**
 * The toolbar's driver loop: applies one event at a time and runs its effects. An effect may dispatch synchronously;
 * its event waits until the current one has applied. A throwing effect never stalls the queue.
 */
export function createQuoteDispatch(driver: {
  readonly read: () => QuoteState
  readonly write: (state: QuoteState) => void
  readonly run: (effect: QuoteEffect) => void
}) {
  const queue: QuoteEvent[] = []

  const apply = (event: QuoteEvent) => {
    const current = driver.read()
    const next = transitionQuote(current, event)

    if (next.state !== current) driver.write(next.state)
    next.effects.forEach((effect) => void Promise.try(() => driver.run(effect)))
  }

  const dispatch = (event: QuoteEvent) => {
    queue.push(event)

    if (queue.length > 1) return

    while (queue.length > 0) {
      void Promise.try(apply, queue[0])
      queue.shift()
    }
  }

  return dispatch
}

type Active = Exclude<QuoteState, { status: "disposed" }>

function shared(state: Active, status: "idle" | "pressing"): QuoteState {
  return { status, issued: state.issued, revision: state.revision, resized: state.resized }
}

function settle(state: Active, effects: readonly QuoteEffect[]): QuoteTransition {
  const attempt = state.issued + 1

  return {
    state: { status: "settling", attempt, issued: attempt, revision: state.revision, resized: state.resized },
    effects: [...effects, { type: "schedule-settle", attempt, delayMs: TERMINAL_QUOTE_SETTLE_MS }],
  }
}

function cancel(state: Active): readonly QuoteEffect[] {
  if (state.status === "settling") return CANCEL_SETTLE

  if (state.status === "shown" && state.placeAttempt !== undefined) return CANCEL_PLACE

  return NONE
}

function layout(state: Active, resized: boolean): QuoteTransition {
  const ticked = { revision: state.revision + 1, resized: state.resized + (resized ? 1 : 0) }

  if (state.status !== "shown") return { state: { ...state, ...ticked }, effects: NONE }

  // One frame places the toolbar for every scroll and resize before it.
  if (state.placeAttempt !== undefined) return { state: { ...state, ...ticked }, effects: NONE }
  const attempt = state.issued + 1

  return {
    state: { ...state, ...ticked, issued: attempt, placeAttempt: attempt },
    effects: [{ type: "schedule-place", attempt }],
  }
}

// A selection read while out of view gets its cells from the first frame that sees it, while they still hold.
function placed(state: Extract<QuoteState, { status: "shown" }>, sample: QuoteSample) {
  const placement = quotePlacement(sample)
  const source = state.source

  if (source.cells || !sample.cells || sample.written !== source.written || state.resized !== source.resized)
    return { placement }

  return { placement, source: { ...source, cells: sample.cells, offset: sample.offset } }
}

function quotePlacement(sample: QuoteSample): QuotePlacement | undefined {
  // The selection scrolled out of view, or the terminal is hidden.
  if (!sample.cells || !sample.origin || !sample.metrics || sample.bounds.height === 0) return

  return { bounds: sample.bounds, anchor: anchorOf(sample.cells, sample.origin, sample.metrics) }
}

// The selection is in cells, so its box comes from the canvas and the cell size.
function anchorOf(
  cells: QuoteCells,
  origin: NonNullable<QuoteSample["origin"]>,
  metrics: NonNullable<QuoteSample["metrics"]>,
): QuoteAnchor {
  return {
    top: origin.top + cells.start.y * metrics.height,
    bottom: origin.top + (cells.end.y + 1) * metrics.height,
    start: origin.left + cells.start.x * metrics.width,
    end: origin.left + (cells.end.x + 1) * metrics.width,
    single: cells.start.y === cells.end.y,
  }
}
