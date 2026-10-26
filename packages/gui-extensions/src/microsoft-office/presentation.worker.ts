import {
  initWasm,
  needsElementDecode,
  openPresentation,
  paintSlide,
  presentationImageBlob,
  type PresentationHandle,
  type SlideDisplayList,
  type SlidePrimitive,
} from "@betteroffice/pptx"
import { slideFonts } from "./slide-fonts"
import {
  maxImageSide,
  type SlideMethods,
  type SlidePainted,
  type SlideSummary,
  type VectorBitmap,
  type VectorRequest,
} from "./slide-protocol"
import { deckText } from "./slide-text"
import { serveWorker, Transfer } from "./worker-rpc"

// One worker holds one open PowerPoint deck: its engine, fonts, laid-out slides, decoded pictures and painting. The
// window terminates the worker when the deck closes, which is the only way the engine's memory is given back.

/** English Metric Units per CSS pixel. */
const emuPerPixel = 9525

/** The most device pixels one slide's bitmap holds, about a 4K screen: a zoomed slide stays sharp up to it. */
const maxBitmapPixels = 3840 * 2160

/** The longest side a canvas takes in every browser. */
const maxBitmapSide = 16384

/**
 * Shadow pixels a slide may blur, per pixel of its bitmap: sixteen slide-sized shadows before they are dropped. Past
 * it a slide gives up its shadows within about half a second, rather than painting for many seconds.
 */
const shadowPixelsPerPixel = 16

/**
 * How many bytes of decoded pictures stay for repaints; the least recently drawn go first past it. A deck of camera
 * photos holds about 17 MB per picture, even scaled down to `maxImageSide`.
 */
const pictureBudget = 128 * 1024 * 1024

type Size = { readonly width: number; readonly height: number }

/**
 * A picture as the painter draws it: a bitmap, an SVG that the window rasterizes (a worker has no SVG decoder) with
 * the bitmap it last returned, or nothing when the browser cannot decode it.
 */
type Picture =
  | { readonly kind: "bitmap"; readonly bitmap: ImageBitmap }
  | { readonly kind: "vector"; readonly blob: Blob; bitmap: ImageBitmap | undefined; failed: boolean }
  | { readonly kind: "missing" }

type Deck = ReturnType<typeof createDeck>

/** The deck this worker opened, once it has. */
type WorkerState = { deck: Deck | undefined }

const state: WorkerState = { deck: undefined }

serveWorker<SlideMethods>({
  open: async (input) => {
    if (state.deck) throw new Error("The worker already holds a deck")

    await initWasm()

    const bytes = new Uint8Array(input.bytes)
    const handle = openPresentation(bytes)
    const snapshot = handle.snapshot()
    const text = deckText(bytes, snapshot)
    const fonts = slideFonts(handle, workerFonts())

    await fonts.load(text)

    state.deck = createDeck(handle, fonts.layout)

    const size = { width: snapshot.widthEmu / emuPerPixel, height: snapshot.heightEmu / emuPerPixel }

    return snapshot.slides.map(
      (slide, index): SlideSummary => ({
        ...size,
        hidden: text.hidden[index] ?? false,
        notes: slide.notes?.trim() || undefined,
      }),
    )
  },
  paint: async (input, signal) => {
    const deck = required()
    const painted = await deck.paint(input.index, input.density, signal).finally(deck.trim)

    return painted.kind === "painted" ? new Transfer(painted, [painted.bitmap]) : painted
  },
  vectors: (input) => required().vectors(input),
})

function required() {
  if (!state.deck) throw new Error("The worker holds no deck")

  return state.deck
}

/** The worker's own font set, which its canvases draw text with. */
function workerFonts() {
  if (!("fonts" in self)) throw new Error("This browser has no fonts in workers")

  // SAFETY: a worker's global scope is a FontFaceSource, whose `fonts` is a FontFaceSet (CSS Font Loading, exposed to
  // workers). The window's types declare it on documents only, and workers expose no FontFaceSet to check against.
  return self.fonts as FontFaceSet
}

function createDeck(handle: PresentationHandle, layout: (index: number) => Promise<SlideDisplayList>) {
  // A frame depends on the slide alone, so a new scale or pixel ratio paints the frame laid out before.
  const frames = new Map<number, Promise<SlideDisplayList | undefined>>()
  const pictures = new Map<string, Promise<Picture>>()
  // The decoded bitmaps, least recently drawn first, which `trim` keeps within `pictureBudget`.
  const drawn = new Map<string, ImageBitmap>()
  const surface = new OffscreenCanvas(1, 1)

  const frame = (index: number) => {
    const cached = frames.get(index)

    if (cached) return cached

    const laid = layout(index).catch(() => undefined)

    frames.set(index, laid)

    return laid
  }

  const decode = async (asset: string): Promise<Picture> => {
    const blob = presentationImageBlob(handle.mediaBytes(asset))

    // SVG decodes through an image element, which a worker lacks.
    if (needsElementDecode(blob)) return { kind: "vector", blob, bitmap: undefined, failed: false }

    const source = await createImageBitmap(blob).catch(() => undefined)

    return source ? { kind: "bitmap", bitmap: await bounded(source) } : { kind: "missing" }
  }

  const picture = (asset: string) => {
    const cached = pictures.get(asset)

    if (cached) return cached

    const decoded = decode(asset).catch((): Picture => ({ kind: "missing" }))

    pictures.set(asset, decoded)

    return decoded
  }

  return {
    paint: async (index: number, density: number, signal: AbortSignal): Promise<SlidePainted> => {
      const laid = await frame(index)

      if (!laid) return { kind: "failed" }

      if (signal.aborted) return { kind: "cancelled" }

      const scale = Math.min(
        density,
        Math.sqrt(maxBitmapPixels / (laid.width * laid.height)),
        maxBitmapSide / Math.max(laid.width, laid.height),
      )

      // One canvas paints every slide: a paint that was withdrawn leaves its pixels for the next to clear, rather than a
      // slide-sized canvas each until the worker collects garbage. A reset context starts as a new canvas's does.
      const canvas = surface
      const width = Math.max(1, Math.round(laid.width * scale))
      const height = Math.max(1, Math.round(laid.height * scale))

      if (canvas.width !== width) canvas.width = width

      if (canvas.height !== height) canvas.height = height

      const context = canvas.getContext("2d")

      if (!context) return { kind: "failed" }

      context.reset()

      const needs = vectorSizes(laid.primitives, scale)
      const wanted = new Map<string, VectorRequest>()

      const resolveImage = async (asset: string) => {
        // A paint that was withdrawn finishes without pictures, and its reply is dropped.
        if (signal.aborted) return null

        const found = await picture(asset)

        if (found.kind === "bitmap") {
          drawn.delete(asset)
          drawn.set(asset, found.bitmap)

          return found.bitmap
        }

        if (found.kind === "missing" || found.failed) return null

        const need = needs.get(asset)

        if (!covers(found.bitmap, need)) wanted.set(asset, { asset, blob: found.blob, size: need })

        return found.bitmap ?? null
      }

      const options = { resolveImage, maxShadowPixels: canvas.width * canvas.height * shadowPixelsPerPixel }

      const attempt = (list: SlideDisplayList) =>
        // SAFETY: the painter draws through the members a worker's 2D context shares with the window's, and makes its
        // scratch canvases with OffscreenCanvas wherever it exists, as it does in a worker. Only the window's context
        // type is declared, and it has two focus and attribute members the worker's lacks, hence the double cast.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
        paintSlide(context as unknown as CanvasRenderingContext2D, list, scale, 1, options).then(
          () => true,
          () => false,
        )

      const shadowed = await attempt(laid)

      // Past its shadow budget a slide throws, and paints again without shadows rather than not at all. It first lets
      // through a cancellation that arrived meanwhile, such as a scroll that moved the slide away.
      if (!shadowed) await new Promise((resolve) => setTimeout(resolve))

      if (signal.aborted) return { kind: "cancelled" }

      const done = shadowed || (await attempt(withoutShadows(laid)))

      if (!done) return { kind: "failed" }

      if (signal.aborted) return { kind: "cancelled" }

      return { kind: "painted", bitmap: canvas.transferToImageBitmap(), vectors: [...wanted.values()] }
    },

    /** Closes the least recently drawn pictures past the budget; they decode again when drawn. Call it between paints. */
    trim: () => {
      ;[...drawn].reduce(
        (total, [asset, bitmap]) => {
          if (total <= pictureBudget) return total

          const freed = pixelBytes(bitmap)

          bitmap.close()
          drawn.delete(asset)
          pictures.delete(asset)

          return total - freed
        },
        [...drawn.values()].reduce((total, bitmap) => total + pixelBytes(bitmap), 0),
      )
    },

    /**
     * Keeps the window's rasterized SVG pictures in place of coarser ones. A finer one that a paint at a larger scale
     * returned stays, and so does any one when the window could not rasterize the picture again.
     */
    vectors: (bitmaps: readonly VectorBitmap[]) =>
      Promise.all(
        bitmaps.map(async (entry) => {
          const found = await picture(entry.asset)

          if (found.kind !== "vector") return entry.bitmap?.close()

          if (found.bitmap && (!entry.bitmap || covers(found.bitmap, entry.bitmap))) return entry.bitmap?.close()

          found.bitmap?.close()
          found.bitmap = entry.bitmap
          found.failed = !entry.bitmap
        }),
      ).then(() => undefined),
  }
}

/**
 * The bitmap size each SVG picture on a slide needs at `scale`: its drawn size in device pixels, before cropping and
 * up to `maxImageSide`. A tiled picture repeats at its own size, so it needs exactly that (undefined).
 */
function vectorSizes(primitives: readonly SlidePrimitive[], scale: number) {
  const sizes = new Map<string, Size | undefined>()

  const visit = (primitive: SlidePrimitive): void => {
    if (primitive.kind === "table" || primitive.kind === "chart") return primitive.primitives.forEach(visit)

    if (primitive.kind !== "image" || !primitive.assetId) return

    const asset = primitive.assetId
    const previous = sizes.get(asset)

    if (primitive.tile || (sizes.has(asset) && !previous)) return void sizes.set(asset, undefined)

    const visibleX = 1 - fraction(primitive.crop?.left) - fraction(primitive.crop?.right)
    const visibleY = 1 - fraction(primitive.crop?.top) - fraction(primitive.crop?.bottom)

    if (visibleX <= 0 || visibleY <= 0) return

    const width = Math.max(previous?.width ?? 0, (primitive.w * scale) / visibleX)
    const height = Math.max(previous?.height ?? 0, (primitive.h * scale) / visibleY)
    const shrink = Math.min(1, maxImageSide / Math.max(width, height))

    sizes.set(asset, {
      width: Math.max(1, Math.ceil(width * shrink)),
      height: Math.max(1, Math.ceil(height * shrink)),
    })
  }

  primitives.forEach(visit)

  return sizes
}

function pixelBytes(bitmap: ImageBitmap) {
  return bitmap.width * bitmap.height * 4
}

/** Whether a rasterized SVG picture is as fine as `need`; undefined needs the picture's own size, rasterized once. */
function covers(bitmap: ImageBitmap | undefined, need: Size | undefined) {
  if (!bitmap) return false

  if (!need) return true

  return bitmap.width >= need.width && bitmap.height >= need.height
}

/** A crop fraction as the painter reads it. */
function fraction(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.min(Math.max(value, 0), 1)
}

function withoutShadows(frame: SlideDisplayList): SlideDisplayList {
  const strip = (primitive: SlidePrimitive): SlidePrimitive => {
    if (primitive.kind === "shape" || primitive.kind === "image") return { ...primitive, shadow: undefined }

    if (primitive.kind === "textBox") return { ...primitive, textShadow: undefined }

    if (primitive.kind === "table" || primitive.kind === "chart")
      return { ...primitive, primitives: primitive.primitives.map(strip) }

    return primitive
  }

  return { ...frame, primitives: frame.primitives.map(strip) }
}

/**
 * The picture scaled down to `maxImageSide` when it is larger. Decks of camera photos would otherwise hold about 100 MB
 * per decoded picture for as long as the deck is open.
 */
async function bounded(source: ImageBitmap) {
  const shrink = maxImageSide / Math.max(source.width, source.height)

  if (shrink >= 1) return source

  return createImageBitmap(source, {
    resizeWidth: Math.max(1, Math.round(source.width * shrink)),
    resizeHeight: Math.max(1, Math.round(source.height * shrink)),
    resizeQuality: "high",
  }).then(
    (resized) => {
      source.close()

      return resized
    },
    () => source,
  )
}
