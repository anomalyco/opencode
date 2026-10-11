import { createMemo, createSignal, Index, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createKeyed } from "../sdk"
import { paper } from "./paper"

/** Paints one page into `canvas` at `scale`; `signal` aborts once a newer paint replaces this one or the page leaves. */
export type PaintPage = (index: number, canvas: HTMLCanvasElement, scale: number, signal: AbortSignal) => Promise<void>

/** Content laid over one page while it is near the viewport, in page pixels times `scale`. */
export type PageOverlay = (input: { readonly index: number; readonly scale: number }) => JSX.Element

/** Scrolls the column so a point of a page shows near the top. */
export type ScrollToPage = (index: number, y: number) => void

/** A page's size and paper colour; a new object for a page is a changed page, which paints again. */
type PageSize = { readonly width: number; readonly height: number; readonly background?: string }

/** Tells a page whether it is near the viewport. */
type Watch = (element: Element, change: (near: boolean) => void) => void

/** A scroll to a page whose row is not mounted yet, if one waits. */
type PendingScroll = { target: { readonly index: number; readonly y: number } | undefined }

/** The observer every page shares, made once the first page mounts. */
type SharedObserver = { value: IntersectionObserver | undefined }

/** The timer of the next slice of rows, and how many rows it mounts. */
type Growth = { timer: ReturnType<typeof setTimeout> | undefined; slice: number }

const padding = 24

/** How long a resize has to settle before visible pages paint again at the new scale. */
const settleDelay = 150

/** The rows mounted with the column: enough to fill a tall screen with the first pages. */
const firstSlice = 6

/** How long mounting one later slice of rows should take, in milliseconds. */
const sliceBudget = 12

/** The most rows one slice mounts. */
const maxSlice = 200

/**
 * A column of pages that fit the pane's width, up to `maxScale`. Only pages near the viewport hold a bitmap, an
 * overlay and the work that keeps them: a long document would otherwise keep hundreds of page-sized canvases in memory,
 * and mount the work for each at once.
 */
export function OfficePages(props: {
  pages: readonly PageSize[]
  maxScale: number
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
  const [width, setWidth] = createSignal(0)
  // The width pages paint at: a resize repaints each visible page once it settles, while the CSS size follows at once.
  const [settled, setSettled] = createSignal(0)
  const [ratio, setRatio] = createSignal(window.devicePixelRatio || 1)
  // How many rows are mounted: the first slice at once, the rest a slice per task.
  const [mounted, setMounted] = createSignal(firstSlice)
  const shown = createMemo(() => props.pages.slice(0, mounted()))
  // A scroll to a page whose row is not mounted yet.
  const pending: PendingScroll = { target: undefined }
  const pages: HTMLDivElement[] = []
  const watched = new Map<Element, (near: boolean) => void>()
  const observer: SharedObserver = { value: undefined }
  let scroller: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  createResizeObserver(
    () => scroller,
    (rect) => {
      setWidth(rect.width)
      clearTimeout(timer)

      if (settled() === 0) return void setSettled(rect.width)

      timer = setTimeout(() => setSettled(rect.width), settleDelay)
    },
  )

  onCleanup(() => {
    clearTimeout(timer)
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

  // Scrolls to a page once its row is mounted.
  const scrollTo: ScrollToPage = (index, y) => {
    const page = pages[index]
    const target = props.pages[index]

    if (!target) return

    if (!scroller || !page || index >= mounted()) return void (pending.target = { index, y })

    pending.target = undefined
    scroller.scrollTo({ top: page.offsetTop + y * fit(width(), target.width) - padding })
  }

  onMount(() => props.onScrollTo?.(scrollTo))

  // Mounts the rows a slice at a time, each slice sized to take about `sliceBudget`, so no one update builds hundreds
  // of them; rows only ever join below the ones mounted, so nothing on screen moves.
  createKeyed(
    () => props.pages.length,
    (total) => {
      const state: Growth = { timer: undefined, slice: firstSlice }

      const grow = () => {
        if (mounted() >= total) return

        const started = performance.now()
        const before = mounted()

        setMounted(Math.min(total, before + state.slice))

        const each = (performance.now() - started) / (mounted() - before)

        state.slice = Math.min(maxSlice, Math.max(1, Math.floor(sliceBudget / each)))

        if (pending.target && pending.target.index < mounted()) scrollTo(pending.target.index, pending.target.y)

        state.timer = setTimeout(grow)
      }

      state.timer = setTimeout(grow)
      onCleanup(() => clearTimeout(state.timer))
    },
  )

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

  const fit = (available: number, page: number) =>
    Math.max(0, Math.min(props.maxScale, (available - padding * 2) / page))

  return (
    <div ref={scroller} data-slot="artifact-stage" class="relative min-h-0 flex-1 overflow-auto">
      <div class="flex flex-col items-center gap-4 py-6">
        {/* Keyed by position: a replaced page keeps its row and canvas, and paints over its old bitmap. */}
        <Index each={shown()}>
          {(page, index) => (
            <div class="flex shrink-0 flex-col items-center gap-3">
              <OfficePage
                ref={(element) => (pages[index] = element)}
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
          )}
        </Index>
      </div>
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
    <div
      ref={(element) => {
        frame = element
        props.ref(element)
      }}
      role={props.text ? "group" : undefined}
      aria-label={props.text ? props.label : undefined}
      class="relative shrink-0 shadow-[var(--v2-elevation-raised)]"
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
    </div>
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
