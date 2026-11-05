import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Loader } from "@opencode/ui/loader"
import { usePlugin } from "@opencode/plugin/gui"
import { createOfficeWorker, type WorkerClient } from "./office-worker"
import { OfficePages, type PaintPage } from "./pages"
import { paper } from "./paper"
import {
  maxImageSide,
  type SlideMethods,
  type SlidePainted,
  type SlideSummary,
  type VectorBitmap,
  type VectorRequest,
} from "./slide-protocol"
import { SupersededError, WorkerClosedError } from "./worker-rpc"
import type { FileViewerProps } from "@opencode/plugin/gui/file"

type Client = WorkerClient<SlideMethods>

/** An opened deck: its worker and its slides. */
type Opened = { readonly client: Client; readonly slides: readonly SlideSummary[] }

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
  const [failed, setFailed] = createStore<boolean[]>([])
  const slides = () => props.opened.slides
  const paint = createPaint(props.opened.client, (index, value) => setFailed(index, value))

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
          <Show when={failed[input.index]}>
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

/**
 * Paints slides through the worker. A newer paint of the same slide replaces a queued one there, and a slide that a
 * scroll or resize took away withdraws its paint, so the worker paints what shows first.
 */
function createPaint(client: Client, painted: (index: number, failed: boolean) => void): PaintPage {
  const paint = async (
    index: number,
    canvas: HTMLCanvasElement,
    scale: number,
    signal: AbortSignal,
    again: boolean,
  ) => {
    const result = await client
      .call("paint", { index, density: (window.devicePixelRatio || 1) * scale }, { key: `slide-${index}`, signal })
      .then(
        (value): SlidePainted | undefined => value,
        // A replaced or withdrawn paint shows nothing; a closed or stopped worker reports itself.
        (error: Error): SlidePainted | undefined =>
          error instanceof SupersededError || error instanceof WorkerClosedError ? undefined : { kind: "failed" },
      )

    // A withdrawn paint rejects above, and the worker closes any bitmap it made for it.
    if (!result || result.kind === "cancelled") return

    painted(index, result.kind === "failed")

    if (result.kind === "failed") {
      canvas.width = 0
      canvas.height = 0

      return
    }

    show(canvas, result.bitmap)

    if (again || result.vectors.length === 0) return

    // The worker cannot decode SVG pictures, so the window rasterizes them at the size the slide draws them and the
    // slide paints again with them.
    const bitmaps = await Promise.all(result.vectors.map(rasterize))

    // A slide that left while its pictures rasterized has no paint to finish.
    if (signal.aborted) return bitmaps.forEach((bitmap) => bitmap.bitmap?.close())

    await client
      .call("vectors", bitmaps, { transfer: bitmaps.flatMap((bitmap) => (bitmap.bitmap ? [bitmap.bitmap] : [])) })
      .then(
        () => (signal.aborted ? undefined : paint(index, canvas, scale, signal, true)),
        () => bitmaps.forEach((bitmap) => bitmap.bitmap?.close()),
      )
  }

  return (index, canvas, scale, signal) => paint(index, canvas, scale, signal, false)
}

function show(canvas: HTMLCanvasElement, bitmap: ImageBitmap) {
  const context = canvas.getContext("bitmaprenderer")

  if (!context) return bitmap.close()

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

  return { asset: request.asset, bitmap }
}

function fitted(width: number, height: number) {
  if (width <= 0 || height <= 0) return undefined

  const shrink = Math.min(1, maxImageSide / Math.max(width, height))

  return { width: Math.max(1, Math.round(width * shrink)), height: Math.max(1, Math.round(height * shrink)) }
}
