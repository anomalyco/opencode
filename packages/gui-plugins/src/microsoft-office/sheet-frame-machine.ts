import type { SheetFrame, SheetFrameRequest, SheetViewport } from "./sheet-protocol"

/** How long after the last scroll a frame of the screen alone replaces the frames with a margin, in milliseconds. */
export const SHEET_SETTLE_DELAY_MS = 150

/**
 * How long one frame may take, its wait behind other workbook calls included, before the grid shows its notice. The
 * worker runs calls one at a time, and a large copy holds it for seconds.
 */
export const SHEET_FRAME_TIMEOUT_MS = 30_000

/** Whether the sheet scrolled within the last `SHEET_SETTLE_DELAY_MS`, so frames reach past the screen. */
export type SheetScroll = "settled" | "moving"

/** The frame on screen, the attempt that asked for it, and what it asked for. */
export type SheetPainted = { readonly attempt: number; readonly request: SheetFrameRequest; readonly frame: SheetFrame }

/**
 * One sheet grid's frames. Each request takes the next attempt number. A newer request does not withdraw a running
 * one: its reply still shows while the newer frame renders, as long as nothing newer has shown.
 */
export type SheetFrameState =
  /** The pane has no size yet, and the paper shows. */
  | { readonly status: "opening"; readonly scroll: SheetScroll }
  /** The newest frame asked for is on screen. */
  | {
      readonly status: "idle"
      readonly scroll: SheetScroll
      readonly issued: number
      readonly painted: SheetPainted | undefined
    }
  /** `failed` keeps the notice of an earlier failure up until a frame shows. */
  | {
      readonly status: "inflight"
      readonly scroll: SheetScroll
      readonly attempt: number
      readonly request: SheetFrameRequest
      readonly painted: SheetPainted | undefined
      readonly failed: boolean
    }
  /** The newest frame could not be drawn: the last frame stays, with a notice, and the next paint asks again. */
  | {
      readonly status: "failed"
      readonly scroll: SheetScroll
      readonly issued: number
      readonly painted: SheetPainted | undefined
    }
  | { readonly status: "disposed" }

export type SheetFrameEvent =
  /** The first paint with a size. */
  | { readonly type: "sheet.opened"; readonly width: number; readonly height: number }
  | { readonly type: "scroll" }
  /** The settle timer fired: no scroll for `SHEET_SETTLE_DELAY_MS`. */
  | { readonly type: "scroll.settled" }
  /** A paint needs a frame the state neither shows nor waits for (see `sheetFrameNeeded`). */
  | { readonly type: "frame.requested"; readonly request: SheetFrameRequest }
  | {
      readonly type: "frame.succeeded"
      readonly attempt: number
      readonly request: SheetFrameRequest
      readonly frame: SheetFrame
    }
  /** The worker could not draw the frame, or the call rejected, superseded or withdrawn included. */
  | { readonly type: "frame.failed"; readonly attempt: number }
  | { readonly type: "frame.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SheetFrameEffect =
  /** Sizes the view and scrolls to where the workbook last showed the sheet, or to a link's target. */
  | { readonly type: "open-sheet"; readonly width: number; readonly height: number }
  /** Arms the settle timer again. */
  | { readonly type: "restart-settle"; readonly delayMs: number }
  /** Paints in the next animation frame. */
  | { readonly type: "schedule-paint" }
  | {
      readonly type: "request-frame"
      readonly attempt: number
      readonly request: SheetFrameRequest
      readonly timeoutMs: number
    }
  | { readonly type: "abort-frame"; readonly attempt: number }
  /** Frees the bitmap of a frame that left the screen or never reached it. */
  | { readonly type: "close-frame"; readonly frame: SheetFrame }
  /** Ends the timers and withdraws every frame still running. */
  | { readonly type: "release" }

export type SheetFrameTransition = { readonly state: SheetFrameState; readonly effects: readonly SheetFrameEffect[] }

const NONE: readonly SheetFrameEffect[] = []

// Every scroll event emits these; one array keeps the scroll path free of allocations.
const SCROLLED: readonly SheetFrameEffect[] = [
  { type: "restart-settle", delayMs: SHEET_SETTLE_DELAY_MS },
  { type: "schedule-paint" },
]

const REPAINT: readonly SheetFrameEffect[] = [{ type: "schedule-paint" }]

export function createSheetFrameState(): SheetFrameState {
  return { status: "opening", scroll: "settled" }
}

export function transitionSheetFrame(state: SheetFrameState, event: SheetFrameEvent): SheetFrameTransition {
  if (state.status === "disposed")
    return { state, effects: event.type === "frame.succeeded" ? [{ type: "close-frame", frame: event.frame }] : NONE }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects:
        state.status !== "opening" && state.painted
          ? [{ type: "close-frame", frame: state.painted.frame }, { type: "release" }]
          : [{ type: "release" }],
    }

  if (event.type === "scroll")
    return { state: state.scroll === "moving" ? state : { ...state, scroll: "moving" }, effects: SCROLLED }

  if (event.type === "scroll.settled")
    return state.scroll === "settled"
      ? { state, effects: NONE }
      : { state: { ...state, scroll: "settled" }, effects: REPAINT }

  if (state.status === "opening")
    return event.type === "sheet.opened"
      ? {
          state: { status: "idle", scroll: state.scroll, issued: 0, painted: undefined },
          effects: [{ type: "open-sheet", width: event.width, height: event.height }],
        }
      : { state, effects: NONE }

  if (event.type === "sheet.opened") return { state, effects: NONE }

  if (event.type === "frame.requested") {
    const attempt = (state.status === "inflight" ? state.attempt : state.issued) + 1

    return {
      state: {
        status: "inflight",
        scroll: state.scroll,
        attempt,
        request: event.request,
        painted: state.painted,
        failed: state.status === "failed" || (state.status === "inflight" && state.failed),
      },
      effects: [{ type: "request-frame", attempt, request: event.request, timeoutMs: SHEET_FRAME_TIMEOUT_MS }],
    }
  }

  if (event.type === "frame.succeeded") return succeeded(state, event)

  if (event.type === "frame.timed-out") {
    const abort: SheetFrameEffect = { type: "abort-frame", attempt: event.attempt }

    // An older frame that hangs holds the worker from the newer one: withdraw it too.
    if (state.status !== "inflight" || event.attempt !== state.attempt) return { state, effects: [abort] }

    return { state: failed(state), effects: [abort] }
  }

  // An older request's failure never shows the notice while a newer one is on the way or already showed.
  if (state.status !== "inflight" || event.attempt !== state.attempt) return { state, effects: NONE }

  return { state: failed(state), effects: NONE }
}

/**
 * Whether a paint must ask for a frame: not while a frame on screen, or the one on the way, still covers what the
 * scroll needs; not again for the frame on screen or on the way; and always after a failure, so the same viewport is
 * asked for again. Runs on every paint, so it allocates nothing.
 */
export function sheetFrameNeeded(
  state: SheetFrameState,
  input: SheetFrameRequest,
  needed: SheetNeeded | undefined,
): boolean {
  if (state.status === "opening" || state.status === "disposed") return false

  if (
    state.scroll === "moving" &&
    needed &&
    ((state.painted && serves(state.painted.request, state.painted.frame.viewport, input, needed)) ||
      (state.status === "inflight" && state.request.wider && serves(state.request, state.request.wider, input, needed)))
  )
    return false

  if (state.status === "inflight") return !sameFrameRequest(state.request, input)

  if (state.status === "idle") return !state.painted || !sameFrameRequest(state.painted.request, input)

  return true
}

/** The area a frame must cover while the sheet scrolls: the screen and half its margin. */
export type SheetNeeded = { readonly x: number; readonly y: number; readonly right: number; readonly bottom: number }

/** Whether the first paint with a size still has to open the sheet. */
export function needsSheetOpen(state: SheetFrameState) {
  return state.status === "opening"
}

/** Whether the sheet scrolled within the settle delay, so frames reach past the screen. */
export function sheetMoving(state: SheetFrameState) {
  return state.status !== "disposed" && state.scroll === "moving"
}

/** The frame on screen; the paper shows until the first one. */
export function sheetPainted(state: SheetFrameState) {
  return state.status === "opening" || state.status === "disposed" ? undefined : state.painted
}

/** Where the sheet's last cell ends, past the frozen panes, as the frame on screen reports it. */
export function sheetEnd(state: SheetFrameState) {
  return sheetPainted(state)?.frame.end
}

/** Whether the notice that the cells here cannot be drawn shows. */
export function sheetPaintFailed(state: SheetFrameState) {
  return state.status === "failed" || (state.status === "inflight" && state.failed)
}

/** Whether two requests ask for the same frame. */
export function sameFrameRequest(left: SheetFrameRequest, right: SheetFrameRequest) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    interchangeable(left, right) &&
    (left.wider === right.wider ||
      (!!left.wider &&
        !!right.wider &&
        left.wider.x === right.wider.x &&
        left.wider.y === right.wider.y &&
        left.wider.width === right.wider.width &&
        left.wider.height === right.wider.height))
  )
}

/** Whether two frames draw the same sheet into the same screen, so one can stand in for the other. */
export function interchangeable(left: SheetFrameRequest, right: SheetFrameRequest) {
  return (
    left.sheet === right.sheet &&
    left.ratio === right.ratio &&
    left.width === right.width &&
    left.height === right.height &&
    left.offset.x === right.offset.x &&
    left.offset.y === right.offset.y
  )
}

function serves(request: SheetFrameRequest, viewport: SheetViewport, input: SheetFrameRequest, needed: SheetNeeded) {
  return (
    interchangeable(request, input) &&
    viewport.x <= needed.x &&
    viewport.y <= needed.y &&
    viewport.x + viewport.width >= needed.right &&
    viewport.y + viewport.height >= needed.bottom
  )
}

function succeeded(
  state: Extract<SheetFrameState, { status: "idle" | "inflight" | "failed" }>,
  event: Extract<SheetFrameEvent, { type: "frame.succeeded" }>,
): SheetFrameTransition {
  // The worker answers in order, so a frame older than the one on screen only arrives after a race; it never replaces it.
  if (event.attempt <= (state.painted?.attempt ?? 0))
    return { state, effects: [{ type: "close-frame", frame: event.frame }] }

  const painted: SheetPainted = { attempt: event.attempt, request: event.request, frame: event.frame }

  const effects: readonly SheetFrameEffect[] = state.painted
    ? [{ type: "close-frame", frame: state.painted.frame }, { type: "schedule-paint" }]
    : REPAINT

  if (state.status === "inflight" && event.attempt === state.attempt)
    return { state: { status: "idle", scroll: state.scroll, issued: state.attempt, painted }, effects }

  // An older frame that finished while the newest renders shows meanwhile, and clears the notice.
  if (state.status === "inflight") return { state: { ...state, painted, failed: false }, effects }

  return { state: { ...state, painted }, effects }
}

function failed(state: Extract<SheetFrameState, { status: "inflight" }>): SheetFrameState {
  return { status: "failed", scroll: state.scroll, issued: state.attempt, painted: state.painted }
}
