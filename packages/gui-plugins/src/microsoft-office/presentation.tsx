import { createSignal, onCleanup, Show, untrack } from "solid-js"
import { Loader } from "@opencode/ui/loader"
import { usePlugin } from "@opencode/plugin/gui"
import { createOfficeWorker, type WorkerClient } from "./office-worker"
import { OfficePages, type PaintPage } from "./pages"
import { paper } from "./paper"
import {
  INITIAL_SLIDE_PAINT_STATE,
  slidePaintAttempt,
  slidePaintFailed,
  transitionSlidePaint,
  type SlidePaintEffect,
  type SlidePaintEvent,
} from "./slide-paint-machine"
import {
  maxImageSide,
  type SlideMethods,
  type SlideSummary,
  type VectorBitmap,
  type VectorRequest,
} from "./slide-protocol"
import { SupersededError, WorkerClosedError } from "./worker-rpc"
import type { FileViewerProps } from "@opencode/plugin/gui/file"

type Client = WorkerClient<SlideMethods>

/** An opened deck: its worker and its slides. */
type Opened = { readonly client: Client; readonly slides: readonly SlideSummary[] }

/** One paint pass or rasterization still running, and the pass's timeout. */
type PaintCall = { readonly controller: AbortController; readonly timer: number | undefined }

/**
 * A read-only PowerPoint deck: every slide fitted to the pane and painted as it scrolls into view, with its speaker
 * notes below it. Hidden slides show dimmed, as in PowerPoint's editor. A worker per deck opens, lays out and paints
 * it, so the window only shows the bitmaps it returns.
 */
export default function OfficePresentation(props: FileViewerProps) {
  const ctx = usePlugin()

  // A worker that stops, such as one out of memory, takes the deck with it.
  const viewer = createOfficeWorker<SlideMethods, Opened>({
    bytes: () => props.bytes,
    createWorker: () =>
      new Worker(new URL("./presentation.worker.ts", import.meta.url), { type: "module", name: "PowerPoint preview" }),
    open: async (client, buffer, signal) => {
      const slides = await client.call("open", { bytes: buffer }, { transfer: [buffer], signal })

      return { value: { client, slides }, details: [ctx.plural("slides", slides.length)] }
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
      {(opened) => <PresentationDeck opened={opened.value} />}
    </Show>
  )
}

/** One opened deck's slides. A reloaded file mounts a new one, with no slide failed. */
function PresentationDeck(props: { opened: Opened }) {
  const ctx = usePlugin()
  const slides = () => props.opened.slides
  // Each slide's paint, at most one per slide; a slide that left has none.
  const [paintState, setPaintState] = createSignal(INITIAL_SLIDE_PAINT_STATE)
  // The paint calls and rasterizations still running, by attempt, and the canvas each slide paints on.
  const calls = new Map<number, PaintCall>()
  const canvases = new Map<number, HTMLCanvasElement>()

  const dispatch = (event: SlidePaintEvent) => {
    const next = transitionSlidePaint(untrack(paintState), event)

    setPaintState(() => next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SlidePaintEffect) => {
    if (effect.type === "request-paint")
      return requestPaint(effect.index, effect.attempt, effect.density, effect.timeoutMs)

    if (effect.type === "abort-paint") {
      const call = calls.get(effect.attempt)

      calls.delete(effect.attempt)
      clearTimeout(call?.timer)
      call?.controller.abort()

      return
    }

    if (effect.type === "show-bitmap") return show(canvases.get(effect.index), effect.bitmap)

    if (effect.type === "close-bitmap") return effect.bitmap.close()

    if (effect.type === "clear-canvas") {
      const canvas = canvases.get(effect.index)

      if (!canvas) return

      canvas.width = 0
      canvas.height = 0

      return
    }

    rasterizeVectors(effect.index, effect.attempt, effect.vectors)
  }

  // Asks the worker for one pass of a slide. A newer paint of the same slide replaces a queued one there, and a slide
  // that a scroll or resize took away withdraws its paint, so the worker paints what shows first.
  const requestPaint = (index: number, attempt: number, density: number, timeoutMs: number) => {
    const call: PaintCall = {
      controller: new AbortController(),
      timer: window.setTimeout(() => dispatch({ type: "pass.timed-out", index, attempt }), timeoutMs),
    }

    const settle = () => {
      clearTimeout(call.timer)

      if (calls.get(attempt) === call) calls.delete(attempt)
    }

    calls.set(attempt, call)
    void props.opened.client
      .call("paint", { index, density }, { key: `slide-${index}`, signal: call.controller.signal })
      .then(
        (result) => {
          settle()
          dispatch(
            result.kind === "painted"
              ? { type: "pass.succeeded", index, attempt, bitmap: result.bitmap, vectors: result.vectors }
              : { type: "pass.failed", index, attempt, quiet: result.kind === "cancelled" },
          )
        },
        (error: Error) => {
          settle()
          // A replaced or withdrawn paint shows nothing; a closed or stopped worker reports itself.
          dispatch({
            type: "pass.failed",
            index,
            attempt,
            quiet: error instanceof SupersededError || error instanceof WorkerClosedError,
          })
        },
      )
  }

  // The worker cannot decode SVG pictures, so the window rasterizes them at the size the slide draws them and hands
  // them over for the second pass.
  const rasterizeVectors = (index: number, attempt: number, vectors: readonly VectorRequest[]) => {
    const call: PaintCall = { controller: new AbortController(), timer: undefined }
    const signal = call.controller.signal

    const settle = () => {
      if (calls.get(attempt) === call) calls.delete(attempt)
    }

    calls.set(attempt, call)
    void Promise.all(vectors.map(rasterize)).then((bitmaps) => {
      const transfer = bitmaps.flatMap((entry) => (entry.bitmap ? [entry.bitmap] : []))

      // A slide that left while its pictures rasterized has no paint to finish.
      if (signal.aborted) return transfer.forEach((bitmap) => bitmap.close())

      return props.opened.client.call("vectors", bitmaps, { transfer }).then(
        () => {
          settle()
          dispatch({ type: "vectors.stored", index, attempt })
        },
        () => {
          settle()
          // A call that failed before it reached the worker still holds the bitmaps.
          transfer.forEach((bitmap) => bitmap.close())
          dispatch({ type: "vectors.failed", index, attempt })
        },
      )
    })
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const paint: PaintPage = (index, canvas, scale, signal) => {
    if (signal.aborted) return Promise.resolve()

    canvases.set(index, canvas)
    dispatch({ type: "paint.started", index, density: (window.devicePixelRatio || 1) * scale })

    const attempt = slidePaintAttempt(untrack(paintState), index)

    if (attempt !== undefined)
      signal.addEventListener("abort", () => dispatch({ type: "paint.aborted", index, attempt }), { once: true })

    return Promise.resolve()
  }

  return (
    <OfficePages
      pages={slides()}
      paint={paint}
      label={(index) => ctx.t("slide", { number: index + 1 })}
      overlay={(input) => (
        <>
          <Show when={slides()[input.index]?.hidden}>
            {/* Paper-coloured, like the slide itself, so a hidden slide fades the same way in every theme. */}
            <div class="pointer-events-none absolute inset-0 opacity-50" style={{ background: paper }} />
          </Show>
          <Show when={slidePaintFailed(paintState(), input.index)}>
            <div class="absolute inset-0 flex items-center justify-center p-4">
              <p
                role="status"
                class="rounded-md bg-v2-background-bg-base px-3 py-1.5 text-12-regular text-v2-text-text-muted shadow-[var(--v2-elevation-raised)]"
              >
                {ctx.t("slideFailed")}
              </p>
            </div>
          </Show>
        </>
      )}
      footer={(index) => (
        <Show when={slides()[index]}>
          {(slide) => (
            <Show when={slide().hidden || slide().notes}>
              {/* Zero width and full minimum width: the slide sets the column's width, and long notes wrap to it. */}
              <div class="flex w-0 min-w-full flex-col items-start gap-1.5">
                <Show when={slide().hidden}>
                  <span class="rounded-[4px] border border-v2-border-border-base px-1.5 text-11-regular text-v2-text-text-muted">
                    {ctx.t("hiddenSlide")}
                  </span>
                </Show>
                <Show when={slide().notes}>
                  {(notes) => (
                    <p
                      role="note"
                      aria-label={ctx.t("speakerNotes")}
                      class="w-full select-text whitespace-pre-wrap [overflow-wrap:anywhere] text-12-regular text-v2-text-text-muted"
                    >
                      {notes()}
                    </p>
                  )}
                </Show>
              </div>
            </Show>
          )}
        </Show>
      )}
    />
  )
}

function show(canvas: HTMLCanvasElement | undefined, bitmap: ImageBitmap) {
  const context = canvas?.getContext("bitmaprenderer")

  if (!canvas || !context) return bitmap.close()

  canvas.width = bitmap.width
  canvas.height = bitmap.height
  context.transferFromImageBitmap(bitmap)
}

/** An SVG picture as a bitmap at the requested size, or at its own size up to `maxImageSide`. */
async function rasterize(request: VectorRequest): Promise<VectorBitmap> {
  const url = URL.createObjectURL(request.blob)
  const image = new Image()

  image.src = url

  const bitmap = await image
    .decode()
    .then(() => {
      const size = request.size ?? fitted(image.naturalWidth, image.naturalHeight)

      if (!size) throw new Error("The picture has no size")

      return createImageBitmap(image, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" })
    })
    .then(
      (value) => value,
      () => undefined,
    )
    .finally(() => URL.revokeObjectURL(url))

  return { asset: request.asset, size: request.size, bitmap }
}

function fitted(width: number, height: number) {
  if (width <= 0 || height <= 0) return undefined

  const shrink = Math.min(1, maxImageSide / Math.max(width, height))

  return { width: Math.max(1, Math.round(width * shrink)), height: Math.max(1, Math.round(height * shrink)) }
}
