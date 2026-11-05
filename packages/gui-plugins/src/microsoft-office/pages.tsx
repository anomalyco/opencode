import { createMemo, createSignal, Index, onCleanup, onMount, Show, untrack, type JSX } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createKeyed } from "@opencode/plugin/gui"
import { PreviewControls } from "@opencode/ui/preview-controls"
import { DocumentSurface } from "@opencode/ui/document-surface"
import {
  INITIAL_OFFICE_PAGES_STATE,
  pageFit,
  pagesControlsDisabled,
  pagesGutter,
  pagesList,
  pagesMounted,
  pagesPendingScrollIndex,
  pagesSettledWidth,
  pagesWidth,
  pagesZoom,
  pagesZoomInDisabled,
  pagesZoomOutDisabled,
  transitionOfficePages,
  type OfficePagesEffect,
  type OfficePagesEvent,
  type PageSize,
} from "./pages-machine"
import { paper } from "./paper"

/** Paints one page into `canvas` at `scale`; `signal` aborts once a newer paint replaces this one or the page leaves. */
export type PaintPage = (index: number, canvas: HTMLCanvasElement, scale: number, signal: AbortSignal) => Promise<void>

/** Content laid over one page while it is near the viewport, in page pixels times `scale`. */
export type PageOverlay = (input: { readonly index: number; readonly scale: number }) => JSX.Element

/** Scrolls the column so a point of a page shows near the top. */
export type ScrollToPage = (index: number, y: number) => void

/** Tells a page whether it is near the viewport. */
type Watch = (element: Element, change: (near: boolean) => void) => void

/** The observer every page shares, made once the first page mounts. */
type SharedObserver = { value: IntersectionObserver | undefined }

/** The resize settle timer, the next growth step's timer, and how long the last growth step took. */
type PagesTimers = {
  settle: ReturnType<typeof setTimeout> | undefined
  growth: ReturnType<typeof setTimeout> | undefined
  elapsed: number | undefined
}

/**
 * A column of pages that fit the pane's width. Only pages near the viewport hold a bitmap, an
 * overlay and the work that keeps them: a long document would otherwise keep hundreds of page-sized canvases in memory,
 * and mount the work for each at once.
 */
export function OfficePages(props: {
  pages: readonly PageSize[]
  paint: PaintPage
  label: (index: number) => string
  /** Laid over each page near the viewport, such as a text layer for selection, links and screen readers. */
  overlay?: PageOverlay
  /** The overlay carries the page's text, so screen readers read it as a page instead of an image. */
  text?: boolean
  /** Shown under each page, such as a slide's speaker notes. */
  footer?: (index: number) => JSX.Element
  /** Receives the column's scroll function once it mounts. */
  onScrollTo?: (scrollTo: ScrollToPage) => void
}) {
  // The pane's width, the rows mounted, a scroll that waits, and the zoom.
  const [pagesState, setPagesState] = createSignal(INITIAL_OFFICE_PAGES_STATE)
  const [ratio, setRatio] = createSignal(window.devicePixelRatio || 1)
  const list = createMemo(() => pagesList(pagesState()))
  const mounted = createMemo(() => pagesMounted(pagesState()))
  const shown = createMemo(() => list().slice(0, mounted()))
  // The width pages size to at once, and the width they paint at once a resize settles.
  const width = createMemo(() => pagesWidth(pagesState()))
  const settled = createMemo(() => pagesSettledWidth(pagesState()))
  const gutter = createMemo(() => pagesGutter(pagesState()))
  const zoom = createMemo(() => pagesZoom(pagesState()))
  // Each mounted row's page, by index, which scrolls measure.
  const rows = new Map<number, HTMLDivElement>()
  const watched = new Map<Element, (near: boolean) => void>()
  const observer: SharedObserver = { value: undefined }
  const timers: PagesTimers = { settle: undefined, growth: undefined, elapsed: undefined }
  // Effects can dispatch while they run (a growth step mounts the row a scroll waits for), so events apply one at a time.
  const queue: OfficePagesEvent[] = []
  let scroller: HTMLDivElement | undefined
  let column: HTMLDivElement | undefined

  const dispatch = (event: OfficePagesEvent) => {
    queue.push(event)

    if (queue.length === 1) drain()
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    try {
      const next = transitionOfficePages(untrack(pagesState), event)

      setPagesState(() => next.state)
      next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(() => undefined))
    } finally {
      queue.shift()
    }

    drain()
  }

  const run = (effect: OfficePagesEffect) => {
    if (effect.type === "schedule-settle") {
      clearTimeout(timers.settle)
      timers.settle = setTimeout(() => dispatch({ type: "resize.settled", attempt: effect.attempt }), effect.delayMs)

      return
    }

    if (effect.type === "cancel-settle") return clearTimeout(timers.settle)

    if (effect.type === "schedule-growth") {
      clearTimeout(timers.growth)
      timers.growth = setTimeout(() => grow(effect.attempt, effect.added))

      return
    }

    if (effect.type === "cancel-growth") return clearTimeout(timers.growth)

    if (effect.type === "scroll-to") {
      const row = rows.get(effect.index)

      if (scroller && row) scroller.scrollTo({ top: row.offsetTop + effect.topOffset })

      return
    }

    scroller?.scrollTo({ left: 0 })
  }

  // Mounts the next slice of rows and times it, so the slice after takes about the budget. Rows only ever join below
  // the ones mounted, so nothing on screen moves.
  const grow = (attempt: number, added: number) => {
    const started = performance.now()

    dispatch({ type: "growth.stepped", attempt, previousElapsedMs: timers.elapsed, previousAdded: added })
    timers.elapsed = performance.now() - started
  }

  // Whether the row a scroll waits for is in the column.
  const pendingRowMounted = () => {
    const index = pagesPendingScrollIndex(untrack(pagesState))

    return index !== undefined && rows.has(index)
  }

  createKeyed(
    () => props.pages,
    (pages) => dispatch({ type: "pages.changed", pages }),
  )

  createResizeObserver(
    () => scroller,
    (rect) => {
      if (!column) return

      dispatch({
        type: "scroller.measured",
        width: rect.width,
        gutter: Number.parseFloat(getComputedStyle(column).paddingInlineStart),
        scrollRowMounted: pendingRowMounted(),
      })
    },
  )

  onCleanup(() => {
    dispatch({ type: "disposed" })
    observer.value?.disconnect()
  })

  // Syncs with the display's pixel ratio, which changes when the window moves to another screen. A media query
  // matches one ratio, so each new ratio arms a new one.
  createKeyed(ratio, (value) => {
    const query = window.matchMedia(`(resolution: ${value}dppx)`)
    const change = () => setRatio(window.devicePixelRatio || 1)

    query.addEventListener("change", change)
    onCleanup(() => query.removeEventListener("change", change))
  })

  // Scrolls to a page once the pane has a width and the page's row is mounted.
  const scrollTo: ScrollToPage = (index, y) =>
    dispatch({ type: "scroll.requested", index, y, rowMounted: rows.has(index) })

  onMount(() => props.onScrollTo?.(scrollTo))

  // One observer for every page. It paints a viewport ahead in both directions, so scrolling rarely reaches a blank
  // page. The column clips its pages, so the margin applies to it: an observer of the window would only see what shows.
  const watch: Watch = (element, change) => {
    observer.value ??= new IntersectionObserver(
      (entries) => entries.forEach((entry) => watched.get(entry.target)?.(entry.isIntersecting)),
      { root: scroller, rootMargin: "100% 0px" },
    )

    watched.set(element, change)
    observer.value.observe(element)
    onCleanup(() => {
      watched.delete(element)
      observer.value?.unobserve(element)
    })
  }

  const fit = (available: number, page: number) => pageFit(available, gutter(), zoom(), page)

  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        data-slot="artifact-stage"
        data-document-surface-scrollport
        class="relative min-h-0 flex-1 overflow-auto"
        data-scrollable
      >
        <div
          ref={column}
          data-document-surface-inset
          data-document-surface-column
          class="flex w-max min-w-full flex-col items-center gap-4 pb-18"
        >
          {/* Keyed by position: a replaced page keeps its row and canvas, and paints over its old bitmap. */}
          <Index each={shown()}>
            {(page, index) => {
              // A scroll that waits for this page runs once its row is in the column.
              onMount(() => {
                if (pagesPendingScrollIndex(untrack(pagesState)) === index) dispatch({ type: "row.mounted", index })
              })
              onCleanup(() => rows.delete(index))

              return (
              <div class="flex shrink-0 flex-col items-center gap-3">
                <OfficePage
                  ref={(element) => rows.set(index, element)}
                  watch={watch}
                  index={index}
                  page={page()}
                  scale={fit(width(), page().width)}
                  rasterScale={fit(settled(), page().width)}
                  ratio={ratio()}
                  paint={props.paint}
                  overlay={props.overlay}
                  text={props.text ?? false}
                  label={props.label(index)}
                />
                {props.footer?.(index)}
              </div>
              )
            }}
          </Index>
        </div>
      </div>
      <PreviewControls
        disabled={pagesControlsDisabled(pagesState())}
        zoomInDisabled={pagesZoomInDisabled(pagesState())}
        zoomOutDisabled={pagesZoomOutDisabled(pagesState())}
        onZoomIn={() => dispatch({ type: "zoom.in" })}
        onZoomOut={() => dispatch({ type: "zoom.out" })}
        onFit={() => dispatch({ type: "zoom.fit" })}
      />
    </div>
  )
}

function OfficePage(props: {
  ref: (element: HTMLDivElement) => void
  watch: Watch
  index: number
  page: PageSize
  scale: number
  rasterScale: number
  ratio: number
  paint: PaintPage
  overlay: PageOverlay | undefined
  text: boolean
  label: string
}) {
  const [visible, setVisible] = createSignal(false)
  let frame: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined

  onMount(() => {
    if (frame) props.watch(frame, setVisible)
  })

  return (
    <DocumentSurface
      ref={(element) => {
        frame = element
        props.ref(element)
      }}
      role={props.text ? "group" : undefined}
      aria-label={props.text ? props.label : undefined}
      class="shrink-0 overflow-hidden"
      style={{
        width: `${props.page.width * props.scale}px`,
        height: `${props.page.height * props.scale}px`,
        // Paper keeps the document's own colour in every theme, as it would print.
        background: props.page.background ?? paper,
      }}
    >
      <canvas
        ref={canvas}
        role={props.text ? undefined : "img"}
        aria-label={props.text ? undefined : props.label}
        aria-hidden={props.text ? "true" : undefined}
        class="absolute inset-0 block size-full"
      />
      <Show when={visible() && canvas}>
        {(target) => (
          <PageBitmap
            canvas={target()}
            index={props.index}
            page={props.page}
            scale={props.scale}
            rasterScale={props.rasterScale}
            ratio={props.ratio}
            paint={props.paint}
            overlay={props.overlay}
          />
        )}
      </Show>
    </DocumentSurface>
  )
}

/** What a page holds while it is near the viewport: its bitmap, kept at the page's scale, and its overlay. */
function PageBitmap(props: {
  canvas: HTMLCanvasElement
  index: number
  page: PageSize
  scale: number
  rasterScale: number
  ratio: number
  paint: PaintPage
  overlay: PageOverlay | undefined
}) {
  // The bitmap's size in device pixels: a new scale that rounds to the same size keeps the bitmap it has. A changed
  // page paints again, and its old bitmap shows until the new one replaces it.
  const raster = createMemo(
    () => (props.rasterScale > 0 ? { scale: props.rasterScale, ratio: props.ratio, page: props.page } : false),
    undefined,
    {
      equals: (previous, next) =>
        previous === next ||
        (!!previous &&
          !!next &&
          previous.page === next.page &&
          Math.round(props.page.width * previous.scale * previous.ratio) ===
            Math.round(props.page.width * next.scale * next.ratio) &&
          Math.round(props.page.height * previous.scale * previous.ratio) ===
            Math.round(props.page.height * next.scale * next.ratio)),
    },
  )

  // The page's one canvas, read once: the cleanup below runs after the `Show` above has let go of it.
  const canvas = props.canvas

  const clear = () => {
    canvas.width = 0
    canvas.height = 0
  }

  // Syncs the canvas bitmap with the page's scale and the display's pixel ratio.
  createKeyed(
    raster,
    (value) => {
      const controller = new AbortController()

      onCleanup(() => controller.abort())
      void props.paint(props.index, canvas, value.scale, controller.signal).catch(() => undefined)
    },
    { otherwise: clear },
  )

  // A page that leaves gives its bitmap back.
  onCleanup(clear)

  return <Show when={props.overlay}>{(overlay) => overlay()({ index: props.index, scale: props.scale })}</Show>
}
