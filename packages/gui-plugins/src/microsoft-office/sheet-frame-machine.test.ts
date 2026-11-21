import { describe, expect, test } from "bun:test"
import {
  SHEET_FRAME_TIMEOUT_MS,
  SHEET_SETTLE_DELAY_MS,
  createSheetFrameState,
  needsSheetOpen,
  sameFrameRequest,
  sheetEnd,
  sheetFrameNeeded,
  sheetMoving,
  sheetPainted,
  sheetPaintFailed,
  transitionSheetFrame,
  type SheetFrameEvent,
  type SheetFrameState,
  type SheetFrameTransition,
  type SheetNeeded,
} from "./sheet-frame-machine"
import type { SheetFrame, SheetFrameRequest, SheetViewport } from "./sheet-protocol"

const request = (x: number, y: number, wider?: SheetViewport): SheetFrameRequest => ({
  sheet: 0,
  x,
  y,
  width: 800,
  height: 600,
  ratio: 2,
  offset: { x: 0.5, y: 0 },
  wider,
})

// The bitmap is never drawn here; the machine only hands it to `close-frame` effects.
const frame = (viewport: SheetViewport, end?: { x: number; y: number }): SheetFrame => ({
  bitmap: { width: 1, height: 1, close: () => undefined },
  viewport,
  grid: undefined,
  hyperlinks: [],
  frozen: { width: 0, height: 0 },
  end,
})

const screen = (x: number, y: number) => ({ x, y, width: 800, height: 600 })

const needed = (x: number, y: number): SheetNeeded => ({ x, y, right: x + 800, bottom: y + 600 })

// Folds the events in order and returns the last transition.
const replay = (events: readonly SheetFrameEvent[], state: SheetFrameState = createSheetFrameState()) =>
  events.reduce<SheetFrameTransition>((last, event) => transitionSheetFrame(last.state, event), {
    state,
    effects: [],
  })

const opened: SheetFrameEvent = { type: "sheet.opened", width: 800, height: 600 }

describe("transitionSheetFrame", () => {
  test("the first paint with a size opens the sheet once", () => {
    const state = createSheetFrameState()

    expect(needsSheetOpen(state)).toBe(true)
    expect(sheetFrameNeeded(state, request(0, 0), undefined)).toBe(false)

    const open = transitionSheetFrame(state, opened)

    expect(open).toEqual({
      state: { status: "idle", scroll: "settled", issued: 0, painted: undefined },
      effects: [{ type: "open-sheet", width: 800, height: 600 }],
    })
    expect(needsSheetOpen(open.state)).toBe(false)
    expect(transitionSheetFrame(open.state, opened).state).toBe(open.state)
  })

  test("a failed viewport is asked for again at the same coordinates", () => {
    const failed = replay([
      opened,
      { type: "frame.requested", request: request(0, 0) },
      { type: "frame.failed", attempt: 1 },
    ])

    expect(failed.state).toEqual({ status: "failed", scroll: "settled", issued: 1, painted: undefined })
    expect(sheetPaintFailed(failed.state)).toBe(true)
    // The settle timer, a click or a focus paints again at the same viewport.
    expect(sheetFrameNeeded(failed.state, request(0, 0), undefined)).toBe(true)

    const retry = transitionSheetFrame(failed.state, { type: "frame.requested", request: request(0, 0) })

    expect(retry.effects).toEqual([
      { type: "request-frame", attempt: 2, request: request(0, 0), timeoutMs: SHEET_FRAME_TIMEOUT_MS },
    ])
    // The notice stays up while the retry renders, as it did before.
    expect(sheetPaintFailed(retry.state)).toBe(true)

    const shown = transitionSheetFrame(retry.state, {
      type: "frame.succeeded",
      attempt: 2,
      request: request(0, 0),
      frame: frame(screen(0, 0)),
    })

    expect(shown.state.status).toBe("idle")
    expect(sheetPaintFailed(shown.state)).toBe(false)
  })

  test("an older frame's failure never shows the notice while a newer one renders or showed", () => {
    const pending = replay([
      opened,
      { type: "frame.requested", request: request(0, 0) },
      { type: "frame.requested", request: request(0, 300) },
    ])

    for (const event of [
      { type: "frame.failed", attempt: 1 },
      { type: "frame.timed-out", attempt: 1 },
    ] satisfies SheetFrameEvent[]) {
      const older = transitionSheetFrame(pending.state, event)

      expect(older.state).toBe(pending.state)
      expect(sheetPaintFailed(older.state)).toBe(false)
    }

    const painted = transitionSheetFrame(pending.state, {
      type: "frame.succeeded",
      attempt: 2,
      request: request(0, 300),
      frame: frame(screen(0, 300)),
    })

    expect(transitionSheetFrame(painted.state, { type: "frame.failed", attempt: 1 }).state).toBe(painted.state)
  })

  test("a settled scroll asks for the screen alone, however early the timer fired", () => {
    const wide = request(0, 300, { x: 0, y: 0, width: 1000, height: 1200 })

    const moving = replay([
      opened,
      { type: "scroll" },
      { type: "frame.requested", request: wide },
      { type: "frame.succeeded", attempt: 1, request: wide, frame: frame({ x: 0, y: 0, width: 1000, height: 1200 }) },
    ])

    expect(sheetMoving(moving.state)).toBe(true)
    // While moving, the wide frame still covers the screen and half the margin.
    expect(sheetFrameNeeded(moving.state, request(0, 320), needed(0, 170))).toBe(false)

    const settled = transitionSheetFrame(moving.state, { type: "scroll.settled" })

    expect(settled.effects).toEqual([{ type: "schedule-paint" }])
    expect(sheetMoving(settled.state)).toBe(false)
    expect(sheetFrameNeeded(settled.state, request(0, 300), needed(0, 150))).toBe(true)
  })

  test("scroll events while moving keep the state object and allocate no effects", () => {
    const first = replay([opened, { type: "scroll" }])

    expect(first.effects).toEqual([
      { type: "restart-settle", delayMs: SHEET_SETTLE_DELAY_MS },
      { type: "schedule-paint" },
    ])

    const second = transitionSheetFrame(first.state, { type: "scroll" })

    expect(second.state).toBe(first.state)
    expect(second.effects).toBe(first.effects)

    const settled = replay([{ type: "scroll.settled" }], replay([opened]).state)

    expect(settled.effects).toEqual([])
  })

  test("an older frame that finishes while a newer one renders shows meanwhile; a later stale one never does", () => {
    const pending = replay([
      opened,
      { type: "frame.requested", request: request(0, 0) },
      { type: "frame.requested", request: request(0, 100) },
      { type: "frame.requested", request: request(0, 200) },
    ])

    const one = frame(screen(0, 0), { x: 5000, y: 9000 })

    const progressive = transitionSheetFrame(pending.state, {
      type: "frame.succeeded",
      attempt: 1,
      request: request(0, 0),
      frame: one,
    })

    expect(progressive.state).toMatchObject({ status: "inflight", attempt: 3 })
    expect(sheetPainted(progressive.state)?.attempt).toBe(1)
    expect(sheetEnd(progressive.state)).toEqual({ x: 5000, y: 9000 })
    expect(progressive.effects).toEqual([{ type: "schedule-paint" }])

    const three = frame(screen(0, 200))

    const idle = transitionSheetFrame(progressive.state, {
      type: "frame.succeeded",
      attempt: 3,
      request: request(0, 200),
      frame: three,
    })

    expect(idle.state).toMatchObject({ status: "idle", issued: 3 })
    expect(idle.effects).toEqual([{ type: "close-frame", frame: one }, { type: "schedule-paint" }])

    const two = frame(screen(0, 100))

    const late = transitionSheetFrame(idle.state, {
      type: "frame.succeeded",
      attempt: 2,
      request: request(0, 100),
      frame: two,
    })

    expect(late.state).toBe(idle.state)
    expect(late.effects).toEqual([{ type: "close-frame", frame: two }])
  })

  test("the frame on screen or on the way is not asked for twice", () => {
    const inflight = replay([opened, { type: "frame.requested", request: request(0, 0) }])

    expect(sheetFrameNeeded(inflight.state, request(0, 0), undefined)).toBe(false)
    expect(sheetFrameNeeded(inflight.state, request(0, 10), undefined)).toBe(true)

    const idle = transitionSheetFrame(inflight.state, {
      type: "frame.succeeded",
      attempt: 1,
      request: request(0, 0),
      frame: frame(screen(0, 0)),
    })

    expect(sheetFrameNeeded(idle.state, request(0, 0), undefined)).toBe(false)
    expect(sheetFrameNeeded(idle.state, request(0, 0, screen(0, 0)), undefined)).toBe(true)
  })

  test("while scrolling, the wider frame on the way covers the screen", () => {
    const wide = request(0, 300, { x: 0, y: 0, width: 1000, height: 1200 })
    const state = replay([opened, { type: "scroll" }, { type: "frame.requested", request: wide }]).state

    expect(sheetFrameNeeded(state, request(0, 320, { x: 0, y: 20, width: 1000, height: 1200 }), needed(0, 170))).toBe(
      false,
    )
    expect(sheetFrameNeeded(state, request(0, 900), needed(0, 750))).toBe(true)
  })

  test("a hung frame times out into the notice and is withdrawn; an older hung frame is withdrawn too", () => {
    const pending = replay([opened, { type: "frame.requested", request: request(0, 0) }])

    expect(transitionSheetFrame(pending.state, { type: "frame.timed-out", attempt: 1 })).toEqual({
      state: { status: "failed", scroll: "settled", issued: 1, painted: undefined },
      effects: [{ type: "abort-frame", attempt: 1 }],
    })

    const newer = transitionSheetFrame(pending.state, { type: "frame.requested", request: request(0, 100) })
    const older = transitionSheetFrame(newer.state, { type: "frame.timed-out", attempt: 1 })

    expect(older.state).toBe(newer.state)
    expect(older.effects).toEqual([{ type: "abort-frame", attempt: 1 }])
  })

  test("disposal releases the frame on screen and closes any frame that lands after it", () => {
    const one = frame(screen(0, 0))

    const shown = replay([
      opened,
      { type: "frame.requested", request: request(0, 0) },
      { type: "frame.succeeded", attempt: 1, request: request(0, 0), frame: one },
    ])

    const disposed = transitionSheetFrame(shown.state, { type: "disposed" })

    expect(disposed).toEqual({
      state: { status: "disposed" },
      effects: [{ type: "close-frame", frame: one }, { type: "release" }],
    })
    expect(transitionSheetFrame(createSheetFrameState(), { type: "disposed" }).effects).toEqual([{ type: "release" }])

    const late = frame(screen(0, 100))

    expect(
      transitionSheetFrame(disposed.state, {
        type: "frame.succeeded",
        attempt: 2,
        request: request(0, 100),
        frame: late,
      }),
    ).toEqual({ state: disposed.state, effects: [{ type: "close-frame", frame: late }] })

    for (const event of [
      { type: "scroll" },
      { type: "frame.failed", attempt: 1 },
      { type: "frame.requested", request: request(0, 0) },
      { type: "disposed" },
    ] satisfies SheetFrameEvent[]) {
      const after = transitionSheetFrame(disposed.state, event)

      expect(after.state).toBe(disposed.state)
      expect(after.effects).toEqual([])
    }

    expect(sheetFrameNeeded(disposed.state, request(0, 0), undefined)).toBe(false)
  })
})

describe("sameFrameRequest", () => {
  test("compares every field, the wider viewport included", () => {
    expect(sameFrameRequest(request(0, 0), request(0, 0))).toBe(true)
    expect(sameFrameRequest(request(0, 0), request(1, 0))).toBe(false)
    expect(sameFrameRequest(request(0, 0, screen(0, 0)), request(0, 0, screen(0, 0)))).toBe(true)
    expect(sameFrameRequest(request(0, 0, screen(0, 0)), request(0, 0))).toBe(false)
    expect(sameFrameRequest(request(0, 0), { ...request(0, 0), offset: { x: 0.25, y: 0 } })).toBe(false)
  })
})
