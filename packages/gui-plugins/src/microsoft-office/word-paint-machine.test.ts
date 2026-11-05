import { describe, expect, test } from "bun:test"
import {
  WORD_PAINT_TIMEOUT_MS,
  createWordPaintState,
  transitionWordPaint,
  wordPaintAttempt,
  wordPaintFailed,
  type WordPaintEvent,
  type WordPaintState,
  type WordPaintTransition,
} from "./word-paint-machine"

// The machine never draws a bitmap; it only hands it to effects.
const bitmap = (width = 1, height = 1): ImageBitmap => ({ width, height, close: () => undefined })

const started = (index = 0, scale = 1): WordPaintEvent => ({ type: "paint.started", index, scale, ratio: 2 })

const replay = (events: readonly WordPaintEvent[], state: WordPaintState = createWordPaintState()) =>
  events.reduce<WordPaintTransition>((last, event) => transitionWordPaint(last.state, event), {
    state,
    effects: [],
  })

describe("transitionWordPaint", () => {
  test("a paint shows its bitmap", () => {
    const start = transitionWordPaint(createWordPaintState(), started())

    expect(start.effects).toEqual([
      { type: "request-paint", index: 0, attempt: 1, scale: 1, ratio: 2, timeoutMs: WORD_PAINT_TIMEOUT_MS },
    ])

    const painted = bitmap()
    const done = transitionWordPaint(start.state, { type: "paint.succeeded", index: 0, attempt: 1, bitmap: painted })

    expect(done.effects).toEqual([{ type: "show-bitmap", index: 0, bitmap: painted }])
    expect(wordPaintFailed(done.state, 0)).toBe(false)
  })

  // A worker paint that threw used to leave blank paper with invisible text over it, and no way to paint again.
  test("a failed paint clears the page, shows its notice, and Try again paints at the same size", () => {
    const failed = replay([started(0, 1.5), { type: "paint.failed", index: 0, attempt: 1, quiet: false }])

    expect(failed.effects).toEqual([{ type: "clear-canvas", index: 0 }])
    expect(wordPaintFailed(failed.state, 0)).toBe(true)

    const retried = transitionWordPaint(failed.state, { type: "paint.retried", index: 0 })

    expect(retried.effects).toEqual([
      { type: "request-paint", index: 0, attempt: 2, scale: 1.5, ratio: 2, timeoutMs: WORD_PAINT_TIMEOUT_MS },
    ])
    expect(wordPaintFailed(retried.state, 0)).toBe(false)

    const painted = bitmap()
    const done = transitionWordPaint(retried.state, { type: "paint.succeeded", index: 0, attempt: 2, bitmap: painted })

    expect(done.effects).toEqual([{ type: "show-bitmap", index: 0, bitmap: painted }])
  })

  // A paint that never settled used to keep the page blank for as long as it stayed in view.
  test("a paint that times out is withdrawn and shows the notice", () => {
    const timed = replay([started(), { type: "paint.timed-out", index: 0, attempt: 1 }])

    expect(timed.effects).toEqual([
      { type: "abort-paint", attempt: 1 },
      { type: "clear-canvas", index: 0 },
    ])
    expect(wordPaintFailed(timed.state, 0)).toBe(true)

    // Its late answer paints nothing over the notice.
    const late = bitmap()

    expect(transitionWordPaint(timed.state, { type: "paint.succeeded", index: 0, attempt: 1, bitmap: late })).toEqual({
      state: timed.state,
      effects: [{ type: "close-bitmap", bitmap: late }],
    })
  })

  // A page that scrolled away used to take a late bitmap onto its cleared canvas.
  test("a page that left frees a late bitmap instead of showing it", () => {
    const left = replay([started(), { type: "paint.aborted", index: 0, attempt: 1 }])

    expect(left.effects).toEqual([{ type: "abort-paint", attempt: 1 }])
    expect(wordPaintAttempt(left.state, 0)).toBeUndefined()

    const late = bitmap()

    expect(transitionWordPaint(left.state, { type: "paint.succeeded", index: 0, attempt: 1, bitmap: late }).effects).toEqual(
      [{ type: "close-bitmap", bitmap: late }],
    )
  })

  test("a replaced or withdrawn paint fails quietly", () => {
    const quiet = replay([started(), { type: "paint.failed", index: 0, attempt: 1, quiet: true }])

    expect(quiet.effects).toEqual([])
    expect(wordPaintFailed(quiet.state, 0)).toBe(false)
    expect(wordPaintAttempt(quiet.state, 0)).toBeUndefined()
  })

  test("a new scale replaces the running paint, and the old one's bitmap is freed", () => {
    const rescaled = replay([started(0, 1), started(0, 2)])

    expect(rescaled.effects).toEqual([
      { type: "abort-paint", attempt: 1 },
      { type: "request-paint", index: 0, attempt: 2, scale: 2, ratio: 2, timeoutMs: WORD_PAINT_TIMEOUT_MS },
    ])

    const stale = bitmap()

    expect(
      transitionWordPaint(rescaled.state, { type: "paint.succeeded", index: 0, attempt: 1, bitmap: stale }).effects,
    ).toEqual([{ type: "close-bitmap", bitmap: stale }])
    expect(
      transitionWordPaint(rescaled.state, { type: "paint.failed", index: 0, attempt: 1, quiet: false }).state,
    ).toBe(rescaled.state)
  })

  test("Try again does nothing for a page that has not failed", () => {
    const painting = replay([started()])

    expect(transitionWordPaint(painting.state, { type: "paint.retried", index: 0 })).toEqual({
      state: painting.state,
      effects: [],
    })
  })

  test("disposal withdraws running paints and frees bitmaps that arrive after it", () => {
    const disposed = replay([started(0), started(1), { type: "paint.failed", index: 1, attempt: 2, quiet: false }, { type: "disposed" }])

    expect(disposed.state.status).toBe("disposed")
    expect(transitionWordPaint(replay([started(0), started(1)]).state, { type: "disposed" }).effects).toEqual([
      { type: "abort-paint", attempt: 1 },
      { type: "abort-paint", attempt: 2 },
    ])

    const late = bitmap()

    expect(transitionWordPaint(disposed.state, { type: "paint.succeeded", index: 0, attempt: 1, bitmap: late }).effects).toEqual(
      [{ type: "close-bitmap", bitmap: late }],
    )
  })
})
