import { createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { createLatest, usePlugin } from "@opencode/plugin/gui"
import { createOfficeWorker, type WorkerClient } from "./office-worker"
import {
  createWordPaintState,
  transitionWordPaint,
  wordPaintAttempt,
  wordPaintFailed,
  type WordPaintEffect,
  type WordPaintEvent,
} from "./word-paint-machine"
import { SupersededError, WorkerClosedError } from "./worker-rpc"
import { OfficePages, type PaintPage, type ScrollToPage } from "./pages"
import {
  createWordLayoutState,
  transitionWordLayout,
  wordLayoutFailed,
  wordLayoutIncomplete,
  wordLayoutLoading,
  wordLayoutPages,
  type WordLayoutEffect,
  type WordLayoutEvent,
} from "./word-layout-machine"
import {
  layerFont,
  lineHeight,
  type WordLink,
  type WordMethods,
  type WordPageSize,
  type WordSpan,
} from "./word-protocol"
import type { FileViewerProps } from "@opencode/plugin/gui/file"

type Client = WorkerClient<WordMethods>

/** An opened document: its worker, and the first pages it laid out with whether more follow. */
type Opened = {
  readonly client: Client
  readonly first: { readonly pages: readonly WordPageSize[]; readonly loading: boolean }
}

/** Scrolls the page column; set once the column mounts. */
type Scroll = { to: ScrollToPage | undefined }

/** The layout step the worker runs, withdrawn when the document closes. */
type Step = { current: AbortController | undefined }

/**
 * A read-only, paginated Word document. Its engine runs in a worker of its own (`document.worker.ts`), which opens the
 * file, lays it out, builds and paints its pages and computes their text; the window only shows the bitmaps and the text
 * layer, so no engine work holds it. The worker loads only the Yrs engine: the parse and layout engines and the
 * collaboration code stay unloaded, and embedded fonts give way to the bundled metric-compatible faces. The first pages
 * show as soon as they are laid out, and the rest lay out in short steps between paints. A transparent text layer over
 * each page makes its text selectable, findable and readable, and its links followable.
 */
export default function OfficeDocument(props: FileViewerProps) {
  const ctx = usePlugin()

  // A worker that dies after the pages showed takes them with it.
  const viewer = createOfficeWorker<WordMethods, Opened>({
    bytes: () => props.bytes,
    createWorker: () => new Worker(new URL("./document.worker.ts", import.meta.url), { type: "module" }),
    open: async (client, buffer, signal) => {
      const first = await client.call("open", { bytes: buffer }, { transfer: [buffer], signal })

      // A longer document reports its page count once the rest is laid out.
      return {
        value: { client, first },
        details: first.loading ? undefined : [ctx.plural("pages", first.pages.length)],
      }
    },
    onDetails: (details) => props.onDetails(details),
    onError: () => props.onError(),
  })

  return (
    <Show
      when={viewer.opened()}
      keyed
      fallback={
        <Show when={viewer.loading()}>
          <div class="flex min-h-0 flex-1 items-center justify-center">
            <Loader />
          </div>
        </Show>
      }
    >
      {(opened) => <DocumentContent opened={opened.value} onDetails={(details) => props.onDetails(details)} />}
    </Show>
  )
}

/**
 * One opened document's pages. A long document lays out the rest of its pages a step at a time once its first pages
 * asked for their paints, which the worker then runs first; a bookmark past the pages laid out starts it sooner.
 */
function DocumentContent(props: { opened: Opened; onDetails: (details: readonly string[]) => void }) {
  const ctx = usePlugin()
  const client = props.opened.client
  const scroll: Scroll = { to: undefined }
  const [layout, setLayout] = createSignal(createWordLayoutState(props.opened.first))
  const step: Step = { current: undefined }
  // Bookmarks that wait for the rest of the layout.
  const waiters: ((completed: boolean) => void)[] = []
  // Each page's text layer, kept for its page object: a page that scrolls back into view shows it without asking the
  // worker. A page the full layout changed gets a new object, and asks again.
  const texts = new WeakMap<WordPageSize, readonly WordSpan[]>()
  const pages = createMemo(() => wordLayoutPages(layout()))
  const loading = createMemo(() => wordLayoutLoading(layout()))
  const failed = createMemo(() => wordLayoutFailed(layout()))
  // Every paint dispatches it, so it is built once.
  const queued: WordLayoutEvent = { type: "paint.queued" }

  const dispatch = (event: WordLayoutEvent) => {
    const next = transitionWordLayout(untrack(layout), event)

    setLayout(() => next.state)
    next.effects.forEach(run)
  }

  const run = (effect: WordLayoutEffect) => {
    if (effect.type === "start-step") return startStep(effect.attempt, effect.defer)

    if (effect.type === "end-step") return step.current?.abort()

    if (effect.type === "report-details") return props.onDetails([ctx.plural("pages", effect.pageCount)])

    waiters.splice(0).forEach((resolve) => resolve(effect.completed))
  }

  const startStep = (attempt: number, defer: boolean) => {
    const controller = new AbortController()

    step.current = controller

    const call = () =>
      void client.call("layout", undefined, { signal: controller.signal }).then(
        (reply) =>
          dispatch(
            reply.done
              ? { type: "step.completed", attempt, pages: reply.pages, kept: reply.kept }
              : { type: "step.progressed", attempt },
          ),
        () => dispatch({ type: "step.failed", attempt }),
      )

    if (defer) return queueMicrotask(call)

    call()
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  // Each page's paint, at most one per page; a page that left has none.
  const [paintState, setPaintState] = createSignal(createWordPaintState())
  // The paint calls still running, by attempt; the canvas each page paints on and the signal its page holds.
  const calls = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  const canvases = new Map<number, { canvas: HTMLCanvasElement; signal: AbortSignal }>()

  const dispatchPaint = (event: WordPaintEvent) => {
    const next = transitionWordPaint(untrack(paintState), event)

    setPaintState(() => next.state)
    next.effects.forEach(runPaint)
  }

  const runPaint = (effect: WordPaintEffect) => {
    if (effect.type === "request-paint")
      return requestPaint(effect.index, effect.attempt, effect.scale, effect.ratio, effect.timeoutMs)

    if (effect.type === "abort-paint") {
      const call = calls.get(effect.attempt)

      calls.delete(effect.attempt)
      clearTimeout(call?.timer)
      call?.controller.abort()

      return
    }

    if (effect.type === "close-bitmap") return effect.bitmap.close()

    const canvas = canvases.get(effect.index)?.canvas

    if (effect.type === "clear-canvas") {
      if (!canvas) return

      canvas.width = 0
      canvas.height = 0

      return
    }

    const context = canvas?.getContext("bitmaprenderer")

    if (!canvas || !context) return effect.bitmap.close()

    canvas.width = effect.bitmap.width
    canvas.height = effect.bitmap.height
    context.transferFromImageBitmap(effect.bitmap)
  }

  // Asks the worker for one page. A newer paint of the page, such as at another scale, replaces this one while it
  // waits, and a page that scrolled away withdraws it.
  const requestPaint = (index: number, attempt: number, scale: number, ratio: number, timeoutMs: number) => {
    const call = {
      controller: new AbortController(),
      timer: setTimeout(() => dispatchPaint({ type: "paint.timed-out", index, attempt }), timeoutMs),
    }

    const settle = () => {
      clearTimeout(call.timer)

      if (calls.get(attempt) === call) calls.delete(attempt)
    }

    calls.set(attempt, call)
    void client
      .call("paint", { index, scale, ratio }, { key: `paint:${index}`, signal: call.controller.signal })
      .then(
        (bitmap) => {
          settle()
          // The worker answers without a bitmap only for a paint it was told to drop, or a page it cannot build.
          dispatchPaint(
            bitmap
              ? { type: "paint.succeeded", index, attempt, bitmap }
              : { type: "paint.failed", index, attempt, quiet: call.controller.signal.aborted },
          )
        },
        (error: Error) => {
          settle()
          // A replaced or withdrawn paint shows nothing; a closed or stopped worker reports itself.
          dispatchPaint({
            type: "paint.failed",
            index,
            attempt,
            quiet: error instanceof SupersededError || error instanceof WorkerClosedError,
          })
        },
      )

    // Builds the next page after the paints waiting, so scrolling on rarely waits for it. Pages stay unbuilt beyond
    // that, and a paint releases the pages far from its own: each built page holds megabytes in the engine.
    void client.call("build", { index: index + 1 }, { key: "build" }).catch(() => undefined)

    // The worker runs calls in order, so the rest of the layout queues behind the first pages' paints.
    dispatch(queued)
  }

  onCleanup(() => dispatchPaint({ type: "disposed" }))

  const paint: PaintPage = (index, canvas, scale, signal) => {
    if (signal.aborted) return Promise.resolve()

    canvases.set(index, { canvas, signal })
    // The page that leaves withdraws whichever paint it holds then, a retried one included.
    signal.addEventListener(
      "abort",
      () => {
        if (canvases.get(index)?.signal !== signal) return
        canvases.delete(index)
        const attempt = wordPaintAttempt(untrack(paintState), index)

        if (attempt !== undefined) dispatchPaint({ type: "paint.aborted", index, attempt })
      },
      { once: true },
    )
    dispatchPaint({ type: "paint.started", index, scale, ratio: window.devicePixelRatio || 1 })

    return Promise.resolve()
  }

  const text = async (index: number, signal: AbortSignal) => {
    const page = pages()[index]
    const cached = page && texts.get(page)

    if (cached) return cached

    const spans = await client.call("text", { index }, { signal })

    if (page) texts.set(page, spans)

    return spans
  }

  // Where a bookmark sits: its page and the height on it, in page pixels. Waits for the layout when it needs to.
  const bookmark = async (name: string) => {
    const found = await client.call("bookmark", { name })

    if (found || !wordLayoutIncomplete(untrack(layout))) return found

    const completed = new Promise<boolean>((resolve) => waiters.push(resolve))

    dispatch({ type: "layout.requested" })

    return (await completed) ? client.call("bookmark", { name }) : undefined
  }

  const follow = (link: WordLink) => {
    if (link.kind === "external") return ctx.system.openExternal(link.url)

    void bookmark(link.bookmark).then(
      (target) => {
        if (target) scroll.to?.(target.index, target.y)
      },
      () => undefined,
    )
  }

  return (
    <OfficePages
      pages={pages()}
      paint={paint}
      label={(index) => ctx.t("page", { number: index + 1 })}
      overlay={(input) => (
        <Show
          when={wordPaintFailed(paintState(), input.index)}
          fallback={<WordTextLayer index={input.index} page={pages()[input.index]} text={text} follow={follow} />}
        >
          {/* A page that could not paint says so, rather than show as blank paper. */}
          <div class="absolute inset-0 flex items-center justify-center p-4">
            <div
              role="status"
              class="flex items-center gap-2 rounded-md bg-v2-background-bg-base px-3 py-1.5 text-12-regular text-v2-text-text-muted shadow-[var(--v2-elevation-raised)]"
            >
              {ctx.t("document.pageFailed")}
              <Button
                size="small"
                variant="outline"
                onClick={() => dispatchPaint({ type: "paint.retried", index: input.index })}
              >
                {ctx.t("common.retry")}
              </Button>
            </div>
          </div>
        </Show>
      )}
      text
      footer={(index) => (
        <Show when={index === pages().length - 1}>
          <Show when={loading()}>
            <Loader />
          </Show>
          <Show when={failed()}>
            <div role="status" class="flex items-center gap-2 text-12-regular text-v2-text-text-muted">
              {ctx.t("document.layoutFailed")}
              <Button size="small" variant="outline" onClick={() => dispatch({ type: "layout.requested" })}>
                {ctx.t("common.retry")}
              </Button>
            </div>
          </Show>
        </Show>
      )}
      onScrollTo={(scrollTo) => {
        scroll.to = scrollTo
      }}
    />
  )
}

/**
 * Transparent text over a page's painted glyphs. Positions are fractions of the page and sizes fractions of its width
 * (container query units), so the layer tracks the page's CSS size at once while a resize waits to repaint.
 */
function WordTextLayer(props: {
  index: number
  /** The page's size object, which the full layout replaces when it changes the page. */
  page: WordPageSize | undefined
  text: (index: number, signal: AbortSignal) => Promise<readonly WordSpan[]>
  follow: (link: WordLink) => void
}) {
  // A changed page asks for its text again; the old text stays until the new arrives.
  const spans = createLatest(
    () => props.page,
    (_, signal) => props.text(props.index, signal),
  )

  return (
    <div
      class="absolute inset-0 select-text overflow-hidden whitespace-pre text-transparent [container-type:inline-size] selection:bg-[rgb(0_120_215/0.3)] selection:text-transparent"
      // Separators flow at the layer's corner; at no size they keep words and paragraphs apart in copied text unseen.
      style={{ "font-family": layerFont, "font-size": "0", "line-height": lineHeight }}
    >
      <For each={spans.latest}>
        {(span) => (
          <>
            <Show
              when={span.link}
              fallback={
                <span dir={span.dir} class="absolute origin-top-left cursor-text" style={place(span)}>
                  {span.text}
                </span>
              }
            >
              {(link) => (
                <span
                  role="link"
                  tabIndex={0}
                  title={span.title}
                  dir={span.dir}
                  class="absolute origin-top-left cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                  style={place(span)}
                  onClick={(event) => {
                    // A drag that ends on the link selects text instead of following it.
                    if (event.button === 0 && (globalThis.getSelection()?.isCollapsed ?? true)) props.follow(link())
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return

                    event.preventDefault()
                    props.follow(link())
                  }}
                >
                  {span.text}
                </span>
              )}
            </Show>
            <Show when={span.after === "br"}>
              <br />
            </Show>
            <Show when={span.after === "tab"}>{"\t"}</Show>
          </>
        )}
      </For>
    </div>
  )
}

function place(span: WordSpan) {
  return {
    left: `${span.left * 100}%`,
    top: `${span.top * 100}%`,
    "font-size": `${span.size * 100}cqw`,
    transform: span.transform,
  }
}
