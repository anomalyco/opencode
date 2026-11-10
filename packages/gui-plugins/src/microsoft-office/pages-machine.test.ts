import { describe, expect, test } from "bun:test"
import {
  INITIAL_OFFICE_PAGES_STATE,
  PAGES_FIRST_SLICE,
  PAGES_MAX_SLICE,
  PAGES_SETTLE_DELAY_MS,
  nextGrowthSlice,
  pagesControlsDisabled,
  pagesMounted,
  pagesPendingScrollIndex,
  pagesScale,
  pagesSettledWidth,
  pagesWidth,
  pagesZoom,
  pagesZoomInDisabled,
  transitionOfficePages,
  type OfficePagesEvent,
  type OfficePagesState,
  type OfficePagesTransition,
  type PageSize,
} from "./pages-machine"

const page = (): PageSize => ({ width: 400, height: 600 })

const pages = (count: number) => Array.from({ length: count }, page)

const measured = (width: number, scrollRowMounted = false): OfficePagesEvent => ({
  type: "scroller.measured",
  width,
  gutter: 0,
  scrollRowMounted,
})

const replay = (events: readonly OfficePagesEvent[], state: OfficePagesState = INITIAL_OFFICE_PAGES_STATE) =>
  events.reduce<OfficePagesTransition>((last, event) => transitionOfficePages(last.state, event), {
    state,
    effects: [],
  })

describe("transitionOfficePages", () => {
  // Bug: a scroll deferred after the growth finished was never flushed.
  test("a scroll that waits for its row runs once the row mounts, after the growth finished", () => {
    const waiting = replay([
      { type: "pages.changed", pages: pages(3) },
      measured(800),
      { type: "scroll.requested", index: 2, y: 100, rowMounted: false },
    ])

    expect(waiting.state.status === "active" && waiting.state.growth.status).toBe("complete")
    expect(waiting.effects).toEqual([])
    expect(pagesPendingScrollIndex(waiting.state)).toBe(2)

    const mounted = transitionOfficePages(waiting.state, { type: "row.mounted", index: 2 })

    expect(mounted.effects).toEqual([{ type: "scroll-to", index: 2, topOffset: 200 }])
    expect(pagesPendingScrollIndex(mounted.state)).toBeUndefined()
  })

  // Bug: a scroll before the first measurement scrolled by `y * 0`.
  test("a scroll before the pane has a width waits for the measurement", () => {
    const waiting = replay([
      { type: "pages.changed", pages: pages(3) },
      { type: "scroll.requested", index: 1, y: 50, rowMounted: true },
    ])

    expect(waiting.effects).toEqual([])
    expect(pagesPendingScrollIndex(waiting.state)).toBe(1)
    expect(transitionOfficePages(waiting.state, { type: "row.mounted", index: 1 }).effects).toEqual([])
    expect(transitionOfficePages(waiting.state, measured(0, true)).effects).toEqual([])

    const ready = transitionOfficePages(waiting.state, measured(800, true))

    expect(ready.effects).toEqual([{ type: "scroll-to", index: 1, topOffset: 100 }])
  })

  test("a scroll to a mounted row in a measured pane runs at once", () => {
    const ready = replay([
      { type: "pages.changed", pages: pages(3) },
      measured(400),
      { type: "scroll.requested", index: 0, y: 30, rowMounted: true },
    ])

    expect(ready.effects).toEqual([{ type: "scroll-to", index: 0, topOffset: 30 }])
    expect(
      transitionOfficePages(ready.state, { type: "scroll.requested", index: 9, y: 0, rowMounted: false }).state,
    ).toBe(ready.state)
  })

  // Bug: a waiting scroll survived a page replacement and ran against the new geometry.
  test("a waiting scroll keeps only the page object it aimed at", () => {
    const first = page()
    const second = page()
    const third = page()

    const waiting = replay([
      { type: "pages.changed", pages: [first, second, third] },
      { type: "scroll.requested", index: 2, y: 10, rowMounted: false },
    ]).state

    // The full layout keeps the objects of pages it left unchanged (`mergeWordPages`).
    const kept = transitionOfficePages(waiting, { type: "pages.changed", pages: [first, second, third, page()] })

    expect(pagesPendingScrollIndex(kept.state)).toBe(2)

    const reflowed = transitionOfficePages(waiting, { type: "pages.changed", pages: [first, second, page(), page()] })

    expect(pagesPendingScrollIndex(reflowed.state)).toBeUndefined()

    const shrunk = transitionOfficePages(waiting, { type: "pages.changed", pages: [first] })

    expect(pagesPendingScrollIndex(shrunk.state)).toBeUndefined()
  })

  // Bug: a hidden warm tab reported width 0, whose settle timer zeroed the raster scale and cleared its canvases.
  test("a hidden pane keeps the width its pages painted at", () => {
    const settled = replay([{ type: "pages.changed", pages: pages(3) }, measured(800)]).state
    const hidden = transitionOfficePages(settled, measured(0))

    expect(hidden).toEqual({ state: settled, effects: [] })
    expect(pagesSettledWidth(hidden.state)).toBe(800)

    const resizing = transitionOfficePages(settled, measured(700)).state
    const hiddenWhileResizing = transitionOfficePages(resizing, measured(0))

    expect(hiddenWhileResizing.effects).toEqual([{ type: "cancel-settle" }])
    expect(pagesSettledWidth(hiddenWhileResizing.state)).toBe(800)
    expect(pagesWidth(hiddenWhileResizing.state)).toBe(800)
  })

  test("a resize sizes pages at once and repaints them once it settles", () => {
    const settled = replay([{ type: "pages.changed", pages: pages(3) }, measured(800)]).state
    const first = transitionOfficePages(settled, measured(700))

    expect(first.effects).toEqual([{ type: "schedule-settle", attempt: 1, delayMs: PAGES_SETTLE_DELAY_MS }])
    expect(pagesWidth(first.state)).toBe(700)
    expect(pagesSettledWidth(first.state)).toBe(800)

    const second = transitionOfficePages(first.state, measured(600))

    expect(second.effects).toEqual([{ type: "schedule-settle", attempt: 2, delayMs: PAGES_SETTLE_DELAY_MS }])
    expect(transitionOfficePages(second.state, { type: "resize.settled", attempt: 1 }).state).toBe(second.state)

    const done = transitionOfficePages(second.state, { type: "resize.settled", attempt: 2 })

    expect(pagesSettledWidth(done.state)).toBe(600)
  })

  test("a height-only change arms nothing, and a resize back to the painted width settles at once", () => {
    const settled = replay([{ type: "pages.changed", pages: pages(3) }, measured(800)]).state

    expect(transitionOfficePages(settled, measured(800))).toEqual({ state: settled, effects: [] })

    const resizing = transitionOfficePages(settled, measured(700)).state

    expect(transitionOfficePages(resizing, measured(700)).state).toBe(resizing)

    const back = transitionOfficePages(resizing, measured(800))

    expect(back.effects).toEqual([{ type: "cancel-settle" }])
    expect(back.state.status === "active" && back.state.measure.status).toBe("settled")
  })

  test("rows mount a slice at a time, with no timer once every row is mounted", () => {
    const short = transitionOfficePages(INITIAL_OFFICE_PAGES_STATE, { type: "pages.changed", pages: pages(4) })

    expect(short.effects).toEqual([])
    expect(pagesMounted(short.state)).toBe(4)

    const long = transitionOfficePages(INITIAL_OFFICE_PAGES_STATE, { type: "pages.changed", pages: pages(20) })

    expect(long.effects).toEqual([{ type: "schedule-growth", attempt: 1, added: 0 }])
    expect(pagesMounted(long.state)).toBe(PAGES_FIRST_SLICE)

    const step = transitionOfficePages(long.state, {
      type: "growth.stepped",
      attempt: 1,
      previousElapsedMs: undefined,
      previousAdded: 0,
    })

    expect(pagesMounted(step.state)).toBe(12)
    expect(step.effects).toEqual([{ type: "schedule-growth", attempt: 1, added: 6 }])

    // 6 rows in 2ms: the next slice takes 36 rows, which reaches the end with no trailing timer.
    const last = transitionOfficePages(step.state, {
      type: "growth.stepped",
      attempt: 1,
      previousElapsedMs: 2,
      previousAdded: 6,
    })

    expect(pagesMounted(last.state)).toBe(20)
    expect(last.effects).toEqual([])
    expect(
      transitionOfficePages(last.state, {
        type: "growth.stepped",
        attempt: 1,
        previousElapsedMs: 1,
        previousAdded: 8,
      }).state,
    ).toBe(last.state)
  })

  test("new pages restart the growth, and a stale step changes nothing", () => {
    const growing = transitionOfficePages(INITIAL_OFFICE_PAGES_STATE, { type: "pages.changed", pages: pages(20) }).state
    const replaced = transitionOfficePages(growing, { type: "pages.changed", pages: pages(30) })

    expect(replaced.effects).toEqual([{ type: "schedule-growth", attempt: 2, added: 0 }])
    expect(
      transitionOfficePages(replaced.state, {
        type: "growth.stepped",
        attempt: 1,
        previousElapsedMs: 1,
        previousAdded: 6,
      }).state,
    ).toBe(replaced.state)

    const shortened = transitionOfficePages(replaced.state, { type: "pages.changed", pages: pages(3) })

    expect(shortened.effects).toEqual([{ type: "cancel-growth" }])
    expect(pagesMounted(shortened.state)).toBe(3)
  })

  test("slices stay between one row and the cap", () => {
    expect(nextGrowthSlice(undefined, 0, PAGES_FIRST_SLICE)).toBe(PAGES_FIRST_SLICE)
    expect(nextGrowthSlice(0, 6, 6)).toBe(PAGES_MAX_SLICE)
    expect(nextGrowthSlice(1000, 1, 6)).toBe(1)
    expect(nextGrowthSlice(6, 6, 6)).toBe(12)
  })

  test("zoom steps between its bounds, and fit scrolls back to the start", () => {
    const state = replay([{ type: "pages.changed", pages: pages(1) }, measured(400)]).state

    expect(pagesScale(state, 400)).toBe(1)

    const zoomed = replay([{ type: "zoom.in" }, { type: "zoom.in" }, { type: "zoom.in" }, { type: "zoom.in" }], state)

    expect(pagesZoom(zoomed.state)).toBe(2)
    expect(pagesZoomInDisabled(zoomed.state)).toBe(true)
    expect(transitionOfficePages(zoomed.state, { type: "zoom.in" }).state).toBe(zoomed.state)

    const fit = transitionOfficePages(zoomed.state, { type: "zoom.fit" })

    expect(pagesZoom(fit.state)).toBe(1)
    expect(fit.effects).toEqual([{ type: "scroll-start-x" }])
  })

  test("controls wait for a width and pages", () => {
    expect(pagesControlsDisabled(INITIAL_OFFICE_PAGES_STATE)).toBe(true)
    expect(pagesControlsDisabled(replay([{ type: "pages.changed", pages: pages(1) }]).state)).toBe(true)
    expect(pagesControlsDisabled(replay([{ type: "pages.changed", pages: pages(1) }, measured(400)]).state)).toBe(false)
  })

  test("disposal cancels the timers and ignores later events", () => {
    const busy = replay([{ type: "pages.changed", pages: pages(20) }, measured(800), measured(700)]).state
    const disposed = transitionOfficePages(busy, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "cancel-settle" }, { type: "cancel-growth" }])
    expect(transitionOfficePages(disposed.state, { type: "resize.settled", attempt: 1 })).toEqual({
      state: disposed.state,
      effects: [],
    })
    expect(pagesMounted(disposed.state)).toBe(0)
  })
})
