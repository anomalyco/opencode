import type { VectorRequest } from "./slide-protocol"

/** How long one slide paint may take, its wait behind other slides included, before the slide shows its notice. */
export const SLIDE_PAINT_TIMEOUT_MS = 30_000

/**
 * One slide's paint at one scale. A slide with SVG pictures paints twice: the worker paints it without them, the
 * window rasterizes them (a worker has no SVG decoder), and the worker paints it again with them.
 */
export type SlideSlotState =
  /** The first paint runs. */
  | { readonly status: "painting"; readonly attempt: number; readonly density: number }
  /** The first paint shows while the window rasterizes the slide's SVG pictures. */
  | { readonly status: "rasterizing-vectors"; readonly attempt: number; readonly density: number }
  /** The first paint shows while the slide paints again with its SVG pictures. */
  | { readonly status: "repainting-with-vectors"; readonly attempt: number; readonly density: number }
  | { readonly status: "painted"; readonly attempt: number }
  /** The slide could not paint: its canvas is cleared and the slide shows a notice. */
  | { readonly status: "failed"; readonly attempt: number }

/** A deck's slide paints, by slide index. Each paint takes the next attempt number; a slide that leaves has no slot. */
export type SlidePaintState =
  | { readonly status: "active"; readonly issued: number; readonly slides: ReadonlyMap<number, SlideSlotState> }
  | { readonly status: "disposed" }

export type SlidePaintEvent =
  /** The column asked to paint a slide at a new scale; the slot takes `issued + 1` as its attempt. */
  | { readonly type: "paint.started"; readonly index: number; readonly density: number }
  /** The slide left, or a newer paint replaced this one. */
  | { readonly type: "paint.aborted"; readonly index: number; readonly attempt: number }
  | {
      readonly type: "pass.succeeded"
      readonly index: number
      readonly attempt: number
      readonly bitmap: ImageBitmap
      readonly vectors: readonly VectorRequest[]
    }
  /** `quiet` when the call was replaced, withdrawn or cancelled, or the worker stopped, which reports itself. */
  | { readonly type: "pass.failed"; readonly index: number; readonly attempt: number; readonly quiet: boolean }
  | { readonly type: "pass.timed-out"; readonly index: number; readonly attempt: number }
  /** The worker took the rasterized SVG pictures. */
  | { readonly type: "vectors.stored"; readonly index: number; readonly attempt: number }
  | { readonly type: "vectors.failed"; readonly index: number; readonly attempt: number }
  | { readonly type: "disposed" }

export type SlidePaintEffect =
  | {
      readonly type: "request-paint"
      readonly index: number
      readonly attempt: number
      readonly density: number
      readonly timeoutMs: number
    }
  /** Withdraws the attempt's running call or rasterization. */
  | { readonly type: "abort-paint"; readonly attempt: number }
  | { readonly type: "show-bitmap"; readonly index: number; readonly bitmap: ImageBitmap }
  /** Frees a bitmap that arrived for a paint nothing shows any more. */
  | { readonly type: "close-bitmap"; readonly bitmap: ImageBitmap }
  | { readonly type: "clear-canvas"; readonly index: number }
  | {
      readonly type: "rasterize-vectors"
      readonly index: number
      readonly attempt: number
      readonly vectors: readonly VectorRequest[]
    }

export type SlidePaintTransition = { readonly state: SlidePaintState; readonly effects: readonly SlidePaintEffect[] }

export const INITIAL_SLIDE_PAINT_STATE: SlidePaintState = Object.freeze({
  status: "active",
  issued: 0,
  slides: new Map<number, SlideSlotState>(),
})

const DISPOSED: SlidePaintState = Object.freeze({ status: "disposed" })

const NONE: readonly SlidePaintEffect[] = []

export function transitionSlidePaint(state: SlidePaintState, event: SlidePaintEvent): SlidePaintTransition {
  if (state.status === "disposed")
    return { state, effects: event.type === "pass.succeeded" ? [{ type: "close-bitmap", bitmap: event.bitmap }] : NONE }

  if (event.type === "disposed")
    return {
      state: DISPOSED,
      effects: [...state.slides.values()].flatMap((slot): SlidePaintEffect[] =>
        inflight(slot) ? [{ type: "abort-paint", attempt: slot.attempt }] : [],
      ),
    }

  if (event.type === "paint.started") {
    const previous = state.slides.get(event.index)
    const attempt = state.issued + 1

    return {
      state: {
        status: "active",
        issued: attempt,
        slides: withSlot(state.slides, event.index, { status: "painting", attempt, density: event.density }),
      },
      effects: [
        ...(previous && inflight(previous) ? [{ type: "abort-paint" as const, attempt: previous.attempt }] : []),
        {
          type: "request-paint",
          index: event.index,
          attempt,
          density: event.density,
          timeoutMs: SLIDE_PAINT_TIMEOUT_MS,
        },
      ],
    }
  }

  const slot = state.slides.get(event.index)
  const current = slot && slot.attempt === event.attempt ? slot : undefined

  if (event.type === "paint.aborted") {
    if (!current) return { state, effects: NONE }

    return {
      state: { ...state, slides: withSlot(state.slides, event.index, undefined) },
      effects: inflight(current) ? [{ type: "abort-paint", attempt: current.attempt }] : NONE,
    }
  }

  if (event.type === "pass.succeeded") {
    // A reply for a slide that left or painted again would hold its memory until collected.
    if (!current || (current.status !== "painting" && current.status !== "repainting-with-vectors"))
      return { state, effects: [{ type: "close-bitmap", bitmap: event.bitmap }] }

    const show: SlidePaintEffect = { type: "show-bitmap", index: event.index, bitmap: event.bitmap }

    // The second paint already has every SVG picture the worker could take.
    if (current.status === "repainting-with-vectors" || event.vectors.length === 0)
      return { state: settle(state, event.index, { status: "painted", attempt: current.attempt }), effects: [show] }

    return {
      state: settle(state, event.index, {
        status: "rasterizing-vectors",
        attempt: current.attempt,
        density: current.density,
      }),
      effects: [
        show,
        { type: "rasterize-vectors", index: event.index, attempt: current.attempt, vectors: event.vectors },
      ],
    }
  }

  if (event.type === "vectors.stored") {
    if (current?.status !== "rasterizing-vectors") return { state, effects: NONE }

    return {
      state: settle(state, event.index, {
        status: "repainting-with-vectors",
        attempt: current.attempt,
        density: current.density,
      }),
      effects: [
        {
          type: "request-paint",
          index: event.index,
          attempt: current.attempt,
          density: current.density,
          timeoutMs: SLIDE_PAINT_TIMEOUT_MS,
        },
      ],
    }
  }

  // The first paint shows: the slide keeps it without its SVG pictures.
  if (event.type === "vectors.failed")
    return current?.status === "rasterizing-vectors"
      ? { state: settle(state, event.index, { status: "painted", attempt: current.attempt }), effects: NONE }
      : { state, effects: NONE }

  const abort: readonly SlidePaintEffect[] =
    event.type === "pass.timed-out" ? [{ type: "abort-paint", attempt: event.attempt }] : NONE

  if (current?.status === "repainting-with-vectors")
    return { state: settle(state, event.index, { status: "painted", attempt: current.attempt }), effects: abort }

  if (current?.status !== "painting") return { state, effects: NONE }

  // A replaced or withdrawn paint shows nothing, and the next paint asks again.
  if (event.type === "pass.failed" && event.quiet)
    return { state: { ...state, slides: withSlot(state.slides, event.index, undefined) }, effects: NONE }

  return {
    state: settle(state, event.index, { status: "failed", attempt: current.attempt }),
    effects: [...abort, { type: "clear-canvas", index: event.index }],
  }
}

/** The attempt of a slide's paint, which its abort names. */
export function slidePaintAttempt(state: SlidePaintState, index: number) {
  return state.status === "active" ? state.slides.get(index)?.attempt : undefined
}

/** Whether a slide shows the notice that it could not paint. */
export function slidePaintFailed(state: SlidePaintState, index: number) {
  return state.status === "active" && state.slides.get(index)?.status === "failed"
}

function inflight(slot: SlideSlotState) {
  return (
    slot.status === "painting" || slot.status === "rasterizing-vectors" || slot.status === "repainting-with-vectors"
  )
}

function settle(state: Extract<SlidePaintState, { status: "active" }>, index: number, slot: SlideSlotState) {
  return { ...state, slides: withSlot(state.slides, index, slot) }
}

function withSlot(slides: ReadonlyMap<number, SlideSlotState>, index: number, slot: SlideSlotState | undefined) {
  const next = new Map(slides)

  if (!slot) {
    next.delete(index)

    return next
  }

  next.set(index, slot)

  return next
}

/** A size in device pixels. */
export type VectorSize = { readonly width: number; readonly height: number }

/** The size an SVG picture was asked at; `"intrinsic"` for its own size, as a tiled picture repeats at. */
export type VectorTarget = VectorSize | "intrinsic"

/** A worker's rasterized copy of one SVG picture, which the window rasterizes for it. */
export type VectorRasterState =
  | { readonly status: "unrasterized" }
  | {
      readonly status: "rasterized"
      readonly bitmap: ImageBitmap
      /** A finer size that the window could not rasterize, so a paint at it keeps `bitmap` without asking again. */
      readonly failedTarget: VectorTarget | undefined
    }
  /** The window could not rasterize the picture at `failedTarget`; any other size asks again. */
  | { readonly status: "failed"; readonly failedTarget: VectorTarget }

/** The window's rasterization at `size` (undefined for the picture's own size); no bitmap when it failed. */
export type VectorRasterEvent = {
  readonly type: "raster.settled"
  readonly size: VectorSize | undefined
  readonly bitmap: ImageBitmap | undefined
}

export type VectorRasterEffect = { readonly type: "close-bitmap"; readonly bitmap: ImageBitmap }

export type VectorRasterTransition = {
  readonly state: VectorRasterState
  readonly effects: readonly VectorRasterEffect[]
}

export const UNRASTERIZED_VECTOR: VectorRasterState = Object.freeze({ status: "unrasterized" })

const NO_RASTER_EFFECTS: readonly VectorRasterEffect[] = []

export function transitionVectorRaster(state: VectorRasterState, event: VectorRasterEvent): VectorRasterTransition {
  const bitmap = event.bitmap
  const target = event.size ?? "intrinsic"

  if (!bitmap) {
    if (state.status === "rasterized")
      return sameVectorTarget(state.failedTarget, target)
        ? { state, effects: NO_RASTER_EFFECTS }
        : { state: { ...state, failedTarget: target }, effects: NO_RASTER_EFFECTS }

    if (state.status === "failed" && sameVectorTarget(state.failedTarget, target))
      return { state, effects: NO_RASTER_EFFECTS }

    return { state: { status: "failed", failedTarget: target }, effects: NO_RASTER_EFFECTS }
  }

  if (state.status !== "rasterized")
    return { state: { status: "rasterized", bitmap, failedTarget: undefined }, effects: NO_RASTER_EFFECTS }

  // A paint at a larger scale may have returned a finer bitmap meanwhile: the finer one stays.
  if (coversVectorSize(state.bitmap, bitmap)) return { state, effects: [{ type: "close-bitmap", bitmap }] }

  return {
    state: { status: "rasterized", bitmap, failedTarget: undefined },
    effects: [{ type: "close-bitmap", bitmap: state.bitmap }],
  }
}

/** The bitmap a paint draws the picture with, if any. */
export function vectorBitmap(state: VectorRasterState) {
  return state.status === "rasterized" ? state.bitmap : null
}

/** Whether a paint that draws the picture at `need` (undefined for its own size) should ask the window for it. */
export function vectorNeedsRaster(state: VectorRasterState, need: VectorSize | undefined) {
  const target = need ?? "intrinsic"

  if (state.status === "unrasterized") return true

  if (state.status === "failed") return !sameVectorTarget(state.failedTarget, target)

  return !coversVectorSize(state.bitmap, need) && !sameVectorTarget(state.failedTarget, target)
}

/** Whether a bitmap is as fine as `need`; the picture's own size (undefined) is rasterized once. */
export function coversVectorSize(bitmap: VectorSize, need: VectorSize | undefined) {
  if (!need) return true

  return bitmap.width >= need.width && bitmap.height >= need.height
}

function sameVectorTarget(left: VectorTarget | undefined, right: VectorTarget) {
  if (left === undefined) return false

  if (left === "intrinsic" || right === "intrinsic") return left === right

  return left.width === right.width && left.height === right.height
}
