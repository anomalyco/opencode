/** How long a resize has to settle before visible pages paint again at the new scale. */
export const PAGES_SETTLE_DELAY_MS = 150

/** The rows mounted with the column: enough to fill a tall screen with the first pages. */
export const PAGES_FIRST_SLICE = 6

/** How long mounting one later slice of rows should take, in milliseconds. */
export const PAGES_SLICE_BUDGET_MS = 12

/** The most rows one slice mounts. */
export const PAGES_MAX_SLICE = 200

export const PAGES_MIN_ZOOM = 0.25

export const PAGES_MAX_ZOOM = 2

export const PAGES_ZOOM_STEP = 1.25

/** The column's inline padding until the first measurement reads it. */
export const PAGES_DEFAULT_GUTTER = 20

/** A page's size and paper colour; a new object for a page is a changed page, which paints again. */
export type PageSize = { readonly width: number; readonly height: number; readonly background?: string }

/** The pane's width: pages size to it at once, and paint at it once a resize settles. */
export type PagesMeasure =
  /** No width yet: the pane has not laid out, or it is hidden. */
  | { readonly status: "unmeasured" }
  | { readonly status: "settled"; readonly width: number; readonly gutter: number }
  /** The pane resizes: pages size to `width` and keep the bitmaps painted at `settledWidth` until it settles. */
  | {
      readonly status: "resizing"
      readonly width: number
      readonly settledWidth: number
      readonly gutter: number
      readonly attempt: number
    }

/** The rows mounted: the first slice at once, the rest a slice per task. */
export type PagesGrowth =
  | { readonly status: "growing"; readonly mounted: number; readonly slice: number; readonly attempt: number }
  | { readonly status: "complete"; readonly mounted: number }

/** A scroll to a page that cannot happen yet, and the page object it aimed at. */
export type PendingPageScroll = { readonly index: number; readonly page: PageSize; readonly y: number }

export type OfficePagesState =
  | {
      readonly status: "active"
      readonly pages: readonly PageSize[]
      readonly measure: PagesMeasure
      readonly growth: PagesGrowth
      readonly scroll: PendingPageScroll | undefined
      readonly zoom: number
      readonly issuedResize: number
      readonly issuedGrowth: number
    }
  | { readonly status: "disposed" }

export type OfficePagesEvent =
  | { readonly type: "pages.changed"; readonly pages: readonly PageSize[] }
  /** The scroller's size changed; `scrollRowMounted` tells whether the pending scroll's row is in the column. */
  | {
      readonly type: "scroller.measured"
      readonly width: number
      readonly gutter: number
      readonly scrollRowMounted: boolean
    }
  | { readonly type: "resize.settled"; readonly attempt: number }
  /** The growth timer fired. The previous step mounted `previousAdded` rows in `previousElapsedMs`. */
  | {
      readonly type: "growth.stepped"
      readonly attempt: number
      readonly previousElapsedMs: number | undefined
      readonly previousAdded: number
    }
  | { readonly type: "scroll.requested"; readonly index: number; readonly y: number; readonly rowMounted: boolean }
  /** The pending scroll's row mounted. */
  | { readonly type: "row.mounted"; readonly index: number }
  | { readonly type: "zoom.in" }
  | { readonly type: "zoom.out" }
  | { readonly type: "zoom.fit" }
  | { readonly type: "disposed" }

export type OfficePagesEffect =
  | { readonly type: "schedule-settle"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-settle" }
  /** Arms the next growth step; `added` is how many rows the step that armed it mounted. */
  | { readonly type: "schedule-growth"; readonly attempt: number; readonly added: number }
  | { readonly type: "cancel-growth" }
  /** Scrolls so the page's top plus `topOffset` CSS pixels shows at the top. */
  | { readonly type: "scroll-to"; readonly index: number; readonly topOffset: number }
  | { readonly type: "scroll-start-x" }

export type OfficePagesTransition = { readonly state: OfficePagesState; readonly effects: readonly OfficePagesEffect[] }

type ActiveState = Extract<OfficePagesState, { status: "active" }>

export const INITIAL_OFFICE_PAGES_STATE: OfficePagesState = Object.freeze({
  status: "active",
  pages: Object.freeze([]),
  measure: Object.freeze({ status: "unmeasured" }),
  growth: Object.freeze({ status: "complete", mounted: 0 }),
  scroll: undefined,
  zoom: 1,
  issuedResize: 0,
  issuedGrowth: 0,
})

const DISPOSED: OfficePagesState = Object.freeze({ status: "disposed" })

const EMPTY: readonly PageSize[] = Object.freeze([])

const NONE: readonly OfficePagesEffect[] = []

const CANCEL_SETTLE: readonly OfficePagesEffect[] = [{ type: "cancel-settle" }]

const CANCEL_GROWTH: readonly OfficePagesEffect[] = [{ type: "cancel-growth" }]

const SCROLL_START: readonly OfficePagesEffect[] = [{ type: "scroll-start-x" }]

export function transitionOfficePages(state: OfficePagesState, event: OfficePagesEvent): OfficePagesTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return {
      state: DISPOSED,
      effects: [
        ...(state.measure.status === "resizing" ? CANCEL_SETTLE : NONE),
        ...(state.growth.status === "growing" ? CANCEL_GROWTH : NONE),
      ],
    }

  if (event.type === "pages.changed") return pagesChanged(state, event.pages)

  if (event.type === "scroller.measured") return measured(state, event)

  if (event.type === "resize.settled") {
    const measure = state.measure

    if (measure.status !== "resizing" || measure.attempt !== event.attempt) return { state, effects: NONE }

    return {
      state: { ...state, measure: { status: "settled", width: measure.width, gutter: measure.gutter } },
      effects: NONE,
    }
  }

  if (event.type === "growth.stepped") return stepped(state, event)

  if (event.type === "scroll.requested") {
    const page = state.pages[event.index]

    if (!page) return { state, effects: NONE }

    const pending = { ...state, scroll: { index: event.index, page, y: event.y } }

    return event.rowMounted ? flush(pending) : { state: pending, effects: NONE }
  }

  if (event.type === "row.mounted") return state.scroll?.index === event.index ? flush(state) : { state, effects: NONE }

  if (event.type === "zoom.fit")
    return { state: state.zoom === 1 ? state : { ...state, zoom: 1 }, effects: SCROLL_START }

  const zoom =
    event.type === "zoom.in"
      ? Math.min(PAGES_MAX_ZOOM, state.zoom * PAGES_ZOOM_STEP)
      : Math.max(PAGES_MIN_ZOOM, state.zoom / PAGES_ZOOM_STEP)

  return { state: zoom === state.zoom ? state : { ...state, zoom }, effects: NONE }
}

/** The pages the column holds. */
export function pagesList(state: OfficePagesState) {
  return state.status === "disposed" ? EMPTY : state.pages
}

/** How many of the pages have a row. */
export function pagesMounted(state: OfficePagesState) {
  return state.status === "disposed" ? 0 : state.growth.mounted
}

/** The width pages size to at once. */
export function pagesWidth(state: OfficePagesState) {
  return state.status === "disposed" || state.measure.status === "unmeasured" ? 0 : state.measure.width
}

/** The width pages paint at: a resize repaints each visible page once it settles. */
export function pagesSettledWidth(state: OfficePagesState) {
  if (state.status === "disposed" || state.measure.status === "unmeasured") return 0

  return state.measure.status === "resizing" ? state.measure.settledWidth : state.measure.width
}

export function pagesGutter(state: OfficePagesState) {
  return state.status === "disposed" || state.measure.status === "unmeasured"
    ? PAGES_DEFAULT_GUTTER
    : state.measure.gutter
}

export function pagesZoom(state: OfficePagesState) {
  return state.status === "disposed" ? 1 : state.zoom
}

/** A page's scale in a pane `width` wide: it fits between the gutters, times the zoom. */
export function pageFit(width: number, gutter: number, zoom: number, pageWidth: number) {
  return Math.max(0, (width - gutter * 2) / pageWidth) * zoom
}

/** A page's CSS scale now. */
export function pagesScale(state: OfficePagesState, pageWidth: number) {
  return pageFit(pagesWidth(state), pagesGutter(state), pagesZoom(state), pageWidth)
}

/** The scale a page's bitmap paints at. */
export function pagesRasterScale(state: OfficePagesState, pageWidth: number) {
  return pageFit(pagesSettledWidth(state), pagesGutter(state), pagesZoom(state), pageWidth)
}

export function pagesControlsDisabled(state: OfficePagesState) {
  return state.status === "disposed" || state.measure.status === "unmeasured" || state.pages.length === 0
}

export function pagesZoomInDisabled(state: OfficePagesState) {
  return pagesZoom(state) >= PAGES_MAX_ZOOM
}

export function pagesZoomOutDisabled(state: OfficePagesState) {
  return pagesZoom(state) <= PAGES_MIN_ZOOM
}

/** The page a scroll waits for, if one does. */
export function pagesPendingScrollIndex(state: OfficePagesState) {
  return state.status === "disposed" ? undefined : state.scroll?.index
}

/** The next slice: sized so mounting it takes about `PAGES_SLICE_BUDGET_MS`, from how long the last one took. */
export function nextGrowthSlice(elapsedMs: number | undefined, added: number, slice: number) {
  if (elapsedMs === undefined || added <= 0) return slice

  return Math.min(PAGES_MAX_SLICE, Math.max(1, Math.floor(PAGES_SLICE_BUDGET_MS / (elapsedMs / added))))
}

function pagesChanged(state: ActiveState, pages: readonly PageSize[]): OfficePagesTransition {
  if (pages === state.pages) return { state, effects: NONE }

  const mounted = Math.min(pages.length, Math.max(PAGES_FIRST_SLICE, state.growth.mounted))
  // A scroll keeps waiting only for the page it aimed at: a reflowed page has other geometry, and a gone one none.
  const scroll = state.scroll && pages[state.scroll.index] === state.scroll.page ? state.scroll : undefined

  if (mounted >= pages.length)
    return {
      state: { ...state, pages, scroll, growth: { status: "complete", mounted } },
      effects: state.growth.status === "growing" ? CANCEL_GROWTH : NONE,
    }

  const attempt = state.issuedGrowth + 1

  return {
    state: {
      ...state,
      pages,
      scroll,
      issuedGrowth: attempt,
      growth: { status: "growing", mounted, slice: PAGES_FIRST_SLICE, attempt },
    },
    effects: [{ type: "schedule-growth", attempt, added: 0 }],
  }
}

function measured(
  state: ActiveState,
  event: Extract<OfficePagesEvent, { type: "scroller.measured" }>,
): OfficePagesTransition {
  const measure = state.measure

  // A hidden pane keeps the width its pages painted at, so a warm tab shows its bitmaps again when it returns.
  if (event.width <= 0) {
    if (measure.status !== "resizing") return { state, effects: NONE }

    return {
      state: { ...state, measure: { status: "settled", width: measure.settledWidth, gutter: measure.gutter } },
      effects: CANCEL_SETTLE,
    }
  }

  if (measure.status === "unmeasured") {
    const next = { ...state, measure: { status: "settled" as const, width: event.width, gutter: event.gutter } }

    return next.scroll && event.scrollRowMounted ? flush(next) : { state: next, effects: NONE }
  }

  // Back to the width the pages painted at: nothing to repaint.
  if (measure.status === "resizing" && event.width === measure.settledWidth)
    return {
      state: { ...state, measure: { status: "settled", width: event.width, gutter: event.gutter } },
      effects: CANCEL_SETTLE,
    }

  // A height-only change.
  if (event.width === measure.width)
    return event.gutter === measure.gutter
      ? { state, effects: NONE }
      : { state: { ...state, measure: { ...measure, gutter: event.gutter } }, effects: NONE }

  const attempt = state.issuedResize + 1

  return {
    state: {
      ...state,
      issuedResize: attempt,
      measure: {
        status: "resizing",
        width: event.width,
        settledWidth: measure.status === "resizing" ? measure.settledWidth : measure.width,
        gutter: event.gutter,
        attempt,
      },
    },
    effects: [{ type: "schedule-settle", attempt, delayMs: PAGES_SETTLE_DELAY_MS }],
  }
}

function stepped(
  state: ActiveState,
  event: Extract<OfficePagesEvent, { type: "growth.stepped" }>,
): OfficePagesTransition {
  const growth = state.growth

  if (growth.status !== "growing" || growth.attempt !== event.attempt) return { state, effects: NONE }

  const slice = nextGrowthSlice(event.previousElapsedMs, event.previousAdded, growth.slice)
  const mounted = Math.min(state.pages.length, growth.mounted + slice)

  if (mounted >= state.pages.length)
    return { state: { ...state, growth: { status: "complete", mounted } }, effects: NONE }

  return {
    state: { ...state, growth: { status: "growing", mounted, slice, attempt: growth.attempt } },
    effects: [{ type: "schedule-growth", attempt: growth.attempt, added: mounted - growth.mounted }],
  }
}

/** Runs the pending scroll once the pane has a width and the page's row is mounted; the caller checked the row. */
function flush(state: ActiveState): OfficePagesTransition {
  const scroll = state.scroll

  if (!scroll || state.measure.status === "unmeasured" || scroll.index >= state.growth.mounted)
    return { state, effects: NONE }

  return {
    state: { ...state, scroll: undefined },
    effects: [{ type: "scroll-to", index: scroll.index, topOffset: scroll.y * pagesScale(state, scroll.page.width) }],
  }
}
