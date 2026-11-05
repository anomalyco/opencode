import { describe, expect, test } from "bun:test"
import {
  INITIAL_SLIDE_PAINT_STATE,
  SLIDE_PAINT_TIMEOUT_MS,
  UNRASTERIZED_VECTOR,
  slidePaintAttempt,
  slidePaintFailed,
  transitionSlidePaint,
  transitionVectorRaster,
  vectorBitmap,
  vectorNeedsRaster,
  type SlidePaintEvent,
  type SlidePaintState,
  type SlidePaintTransition,
  type VectorRasterState,
} from "./slide-paint-machine"
import type { VectorRequest } from "./slide-protocol"

// The machine never draws a bitmap; it only hands it to effects.
const bitmap = (width = 1, height = 1): ImageBitmap => ({ width, height, close: () => undefined })

const vector: VectorRequest = { asset: "svg", blob: new Blob(["<svg/>"]), size: { width: 400, height: 300 } }

const started = (index = 0): SlidePaintEvent => ({ type: "paint.started", index, density: 2 })

const replay = (events: readonly SlidePaintEvent[], state: SlidePaintState = INITIAL_SLIDE_PAINT_STATE) =>
  events.reduce<SlidePaintTransition>((last, event) => transitionSlidePaint(last.state, event), {
    state,
    effects: [],
  })

describe("transitionSlidePaint", () => {
  test("a slide without SVG pictures paints once", () => {
    const start = transitionSlidePaint(INITIAL_SLIDE_PAINT_STATE, started())

    expect(start.effects).toEqual([
      { type: "request-paint", index: 0, attempt: 1, density: 2, timeoutMs: SLIDE_PAINT_TIMEOUT_MS },
    ])

    const painted = bitmap()

    const done = transitionSlidePaint(start.state, {
      type: "pass.succeeded",
      index: 0,
      attempt: 1,
      bitmap: painted,
      vectors: [],
    })

    expect(done.effects).toEqual([{ type: "show-bitmap", index: 0, bitmap: painted }])
    expect(slidePaintFailed(done.state, 0)).toBe(false)
  })

  test("a slide with SVG pictures shows its first pass, then paints again with them", () => {
    const first = bitmap()
    const second = bitmap()

    const pass1 = replay([
      started(),
      { type: "pass.succeeded", index: 0, attempt: 1, bitmap: first, vectors: [vector] },
    ])

    expect(pass1.effects).toEqual([
      { type: "show-bitmap", index: 0, bitmap: first },
      { type: "rasterize-vectors", index: 0, attempt: 1, vectors: [vector] },
    ])

    const stored = transitionSlidePaint(pass1.state, { type: "vectors.stored", index: 0, attempt: 1 })

    expect(stored.effects).toEqual([
      { type: "request-paint", index: 0, attempt: 1, density: 2, timeoutMs: SLIDE_PAINT_TIMEOUT_MS },
    ])

    // Pictures the second pass still lacks are not asked for again.
    const pass2 = transitionSlidePaint(stored.state, {
      type: "pass.succeeded",
      index: 0,
      attempt: 1,
      bitmap: second,
      vectors: [vector],
    })

    expect(pass2.effects).toEqual([{ type: "show-bitmap", index: 0, bitmap: second }])
    expect(pass2.state.status === "active" && pass2.state.slides.get(0)?.status).toBe("painted")
  })

  // Bug: a reply that settled before the slide left still drew its bitmap onto the cleared canvas.
  test("a reply for a slide that left closes its bitmap", () => {
    const left = replay([started(), { type: "paint.aborted", index: 0, attempt: 1 }])

    expect(left.effects).toEqual([{ type: "abort-paint", attempt: 1 }])
    expect(slidePaintAttempt(left.state, 0)).toBeUndefined()

    const late = bitmap()

    expect(
      transitionSlidePaint(left.state, { type: "pass.succeeded", index: 0, attempt: 1, bitmap: late, vectors: [] }),
    ).toEqual({ state: left.state, effects: [{ type: "close-bitmap", bitmap: late }] })
  })

  test("a reply for a paint a newer scale replaced closes its bitmap", () => {
    const rescaled = replay([started(), started()])

    expect(rescaled.effects).toEqual([
      { type: "abort-paint", attempt: 1 },
      { type: "request-paint", index: 0, attempt: 2, density: 2, timeoutMs: SLIDE_PAINT_TIMEOUT_MS },
    ])

    const stale = bitmap()

    expect(
      transitionSlidePaint(rescaled.state, { type: "pass.succeeded", index: 0, attempt: 1, bitmap: stale, vectors: [] })
        .effects,
    ).toEqual([{ type: "close-bitmap", bitmap: stale }])
  })

  // Bug: a failed second pass marked the slide failed and wiped the first pass off its canvas.
  test("a second pass that fails or hangs keeps the first pass on the canvas", () => {
    const repainting = replay([
      started(),
      { type: "pass.succeeded", index: 0, attempt: 1, bitmap: bitmap(), vectors: [vector] },
      { type: "vectors.stored", index: 0, attempt: 1 },
    ]).state

    const failed = transitionSlidePaint(repainting, { type: "pass.failed", index: 0, attempt: 1, quiet: false })

    expect(failed.effects).toEqual([])
    expect(slidePaintFailed(failed.state, 0)).toBe(false)

    const timed = transitionSlidePaint(repainting, { type: "pass.timed-out", index: 0, attempt: 1 })

    expect(timed.effects).toEqual([{ type: "abort-paint", attempt: 1 }])
    expect(slidePaintFailed(timed.state, 0)).toBe(false)

    const unstored = replay([
      started(),
      { type: "pass.succeeded", index: 0, attempt: 1, bitmap: bitmap(), vectors: [vector] },
      { type: "vectors.failed", index: 0, attempt: 1 },
    ])

    expect(unstored.effects).toEqual([])
    expect(slidePaintFailed(unstored.state, 0)).toBe(false)
  })

  test("a first pass that fails clears the canvas and shows the notice", () => {
    const failed = replay([started(), { type: "pass.failed", index: 0, attempt: 1, quiet: false }])

    expect(failed.effects).toEqual([{ type: "clear-canvas", index: 0 }])
    expect(slidePaintFailed(failed.state, 0)).toBe(true)

    // Painting again at another scale clears the notice until it settles.
    expect(slidePaintFailed(transitionSlidePaint(failed.state, started()).state, 0)).toBe(false)
  })

  // Bug: a paint that hung left the slide blank with no bound.
  test("a first pass that hangs times out, is withdrawn and shows the notice", () => {
    const timed = replay([started(), { type: "pass.timed-out", index: 0, attempt: 1 }])

    expect(timed.effects).toEqual([
      { type: "abort-paint", attempt: 1 },
      { type: "clear-canvas", index: 0 },
    ])
    expect(slidePaintFailed(timed.state, 0)).toBe(true)
  })

  test("a replaced, withdrawn or cancelled paint shows nothing", () => {
    const quiet = replay([started(), { type: "pass.failed", index: 0, attempt: 1, quiet: true }])

    expect(quiet.effects).toEqual([])
    expect(slidePaintFailed(quiet.state, 0)).toBe(false)
    expect(slidePaintAttempt(quiet.state, 0)).toBeUndefined()
  })

  test("disposal withdraws every running paint and closes late bitmaps", () => {
    const disposed = replay([
      started(0),
      started(1),
      { type: "pass.succeeded", index: 1, attempt: 2, bitmap: bitmap(), vectors: [] },
      started(2),
      { type: "pass.succeeded", index: 2, attempt: 3, bitmap: bitmap(), vectors: [vector] },
      { type: "disposed" },
    ])

    expect(disposed.state.status).toBe("disposed")
    expect(disposed.effects).toEqual([
      { type: "abort-paint", attempt: 1 },
      { type: "abort-paint", attempt: 3 },
    ])

    const late = bitmap()

    expect(
      transitionSlidePaint(disposed.state, { type: "pass.succeeded", index: 0, attempt: 1, bitmap: late, vectors: [] })
        .effects,
    ).toEqual([{ type: "close-bitmap", bitmap: late }])
    expect(transitionSlidePaint(disposed.state, started()).effects).toEqual([])
  })
})

describe("transitionVectorRaster", () => {
  // Bug: one failed rasterization marked the SVG failed for the life of the deck, at every scale.
  test("a failed size is not asked for again, while another size is", () => {
    const failed = transitionVectorRaster(UNRASTERIZED_VECTOR, {
      type: "raster.settled",
      size: { width: 2000, height: 1500 },
      bitmap: undefined,
    }).state

    expect(failed).toEqual({ status: "failed", failedTarget: { width: 2000, height: 1500 } })
    expect(vectorBitmap(failed)).toBeNull()
    expect(vectorNeedsRaster(failed, { width: 2000, height: 1500 })).toBe(false)
    expect(vectorNeedsRaster(failed, { width: 800, height: 600 })).toBe(true)

    const smaller = bitmap(800, 600)

    const rasterized = transitionVectorRaster(failed, {
      type: "raster.settled",
      size: { width: 800, height: 600 },
      bitmap: smaller,
    })

    expect(rasterized).toEqual({
      state: { status: "rasterized", bitmap: smaller, failedTarget: undefined },
      effects: [],
    })
  })

  // Bug: a failed finer upgrade recorded nothing, so every paint at that zoom asked again forever.
  test("a failed finer size keeps the coarser bitmap and is not asked for again", () => {
    const coarse = bitmap(400, 300)
    const rasterized: VectorRasterState = { status: "rasterized", bitmap: coarse, failedTarget: undefined }

    const upgrade = transitionVectorRaster(rasterized, {
      type: "raster.settled",
      size: { width: 1200, height: 900 },
      bitmap: undefined,
    })

    expect(upgrade).toEqual({
      state: { status: "rasterized", bitmap: coarse, failedTarget: { width: 1200, height: 900 } },
      effects: [],
    })
    expect(vectorBitmap(upgrade.state)).toBe(coarse)
    expect(vectorNeedsRaster(upgrade.state, { width: 1200, height: 900 })).toBe(false)
    expect(vectorNeedsRaster(upgrade.state, { width: 800, height: 600 })).toBe(true)
    expect(vectorNeedsRaster(upgrade.state, { width: 300, height: 200 })).toBe(false)

    const fine = bitmap(1200, 900)

    expect(
      transitionVectorRaster(upgrade.state, {
        type: "raster.settled",
        size: { width: 1200, height: 900 },
        bitmap: fine,
      }),
    ).toEqual({
      state: { status: "rasterized", bitmap: fine, failedTarget: undefined },
      effects: [{ type: "close-bitmap", bitmap: coarse }],
    })

    const coarser = bitmap(200, 150)

    expect(
      transitionVectorRaster(upgrade.state, {
        type: "raster.settled",
        size: { width: 200, height: 150 },
        bitmap: coarser,
      }),
    ).toEqual({ state: upgrade.state, effects: [{ type: "close-bitmap", bitmap: coarser }] })
  })

  test("a picture at its own size rasterizes once", () => {
    expect(vectorNeedsRaster(UNRASTERIZED_VECTOR, undefined)).toBe(true)

    const own = transitionVectorRaster(UNRASTERIZED_VECTOR, {
      type: "raster.settled",
      size: undefined,
      bitmap: bitmap(64, 64),
    }).state

    expect(vectorNeedsRaster(own, undefined)).toBe(false)

    const failed = transitionVectorRaster(UNRASTERIZED_VECTOR, {
      type: "raster.settled",
      size: undefined,
      bitmap: undefined,
    }).state

    expect(vectorNeedsRaster(failed, undefined)).toBe(false)
    expect(vectorNeedsRaster(failed, { width: 10, height: 10 })).toBe(true)
    expect(transitionVectorRaster(failed, { type: "raster.settled", size: undefined, bitmap: undefined }).state).toBe(
      failed,
    )
  })
})
