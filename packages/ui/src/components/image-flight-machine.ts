import type { FlightFrame } from "./image-flight"

/**
 * How long the preview waits for its image to decode before it opens anyway. Decoding first keeps the flight's first
 * frames smooth; a decode that hangs, such as the stand-in's on a slow second fetch, must not keep the preview hidden.
 */
export const DECODE_TIMEOUT_MS = 1000

/** What `data-stage` tells the stylesheet: hidden, a stand-in flying, the preview at rest, or fading out after a close. */
export type PreviewFlightStage = "pending" | "flying" | "rest" | "closing"

/**
 * The preview's life from load to close. `attempt` counts image loads, so a decode that settles after the image
 * changed or loaded again is ignored. `borrowed` says the preview holds the page's video, which it hands back once the
 * close lands. `originHidden` says the origin on the page is hidden because the image flew out of it.
 *
 * A close flies home when the origin still shows, then fades the stand-in over the page's image (`veil`). It only
 * fades when the origin is gone, out of sight, or motion is reduced (`fade`).
 */
export type PreviewFlightState =
  | { readonly status: "pending"; readonly attempt: number }
  | { readonly status: "decoding"; readonly attempt: number }
  | { readonly status: "opening"; readonly mode: "flight" | "fade"; readonly borrowed: boolean }
  | { readonly status: "open"; readonly originHidden: boolean; readonly borrowed: boolean }
  | { readonly status: "closing"; readonly mode: "flight" | "veil" | "fade"; readonly borrowed: boolean }
  | { readonly status: "closed" }
  | { readonly status: "disposed" }

/** `origin` is the origin's frame to fly from or to, or nothing when it is gone, out of sight, or motion is reduced. */
export type PreviewFlightEvent =
  | { readonly type: "src.changed" }
  | { readonly type: "image.loaded" }
  | { readonly type: "image.failed" }
  | { readonly type: "decode.ready"; readonly attempt: number; readonly origin: FlightFrame | undefined }
  | { readonly type: "video.ready"; readonly origin: FlightFrame | undefined }
  | { readonly type: "close.started"; readonly origin: FlightFrame | undefined }
  /** The flight landed with the backdrop at rest, or, without a flight, the backdrop and the veil came to rest. */
  | { readonly type: "motion.settled" }
  | { readonly type: "disposed" }

export type PreviewFlightEffect =
  | { readonly type: "decode.start"; readonly attempt: number }
  | { readonly type: "decode.cancel" }
  | { readonly type: "video.borrow" }
  | { readonly type: "video.return" }
  | { readonly type: "origin.hide" }
  | { readonly type: "origin.show" }
  | { readonly type: "open.flight"; readonly from: FlightFrame }
  | { readonly type: "open.fade" }
  /** `turn` turns the opening flight around where it is, keeping its velocity, instead of starting from rest. */
  | { readonly type: "close.flight"; readonly to: FlightFrame; readonly turn: boolean }
  | { readonly type: "close.veil" }
  | { readonly type: "close.fade" }
  /** A video eases back to its whole frame on the way home; an image stops where it is and flies as it is shown. */
  | { readonly type: "zoom.fit" }
  | { readonly type: "zoom.settle" }
  | { readonly type: "body.closing.acquire" }
  | { readonly type: "body.closing.release" }
  | { readonly type: "loop.stop" }

export type PreviewFlightTransition = {
  readonly state: PreviewFlightState
  readonly effects: readonly PreviewFlightEffect[]
}

export const INITIAL_PREVIEW_FLIGHT_STATE: PreviewFlightState = Object.freeze({ status: "pending", attempt: 0 })

const CLOSED: PreviewFlightState = Object.freeze({ status: "closed" })

const DISPOSED: PreviewFlightState = Object.freeze({ status: "disposed" })

const NONE: readonly PreviewFlightEffect[] = Object.freeze([])

export function transitionPreviewFlight(state: PreviewFlightState, event: PreviewFlightEvent): PreviewFlightTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: DISPOSED, effects: teardown(state) }

  if (event.type === "close.started") return close(state, event.origin)

  if (state.status === "pending" || state.status === "decoding") return reveal(state, event)

  if (event.type !== "motion.settled") return { state, effects: NONE }

  return settle(state)
}

export function selectFlightStage(state: PreviewFlightState): PreviewFlightStage {
  if (state.status === "pending" || state.status === "decoding") return "pending"

  if (state.status === "opening") return state.mode === "flight" ? "flying" : "rest"

  if (state.status === "open") return "rest"

  if (state.status === "closing" && state.mode !== "fade") return "flying"

  return "closing"
}

/** Whether the preview takes zoom, pan and keyboard input: from the moment it reveals until a close starts. */
export function selectFlightInteractive(state: PreviewFlightState) {
  return state.status === "opening" || state.status === "open"
}

/** Whether the preview, its controls and a borrowed video fade with the backdrop rather than flying. */
export function selectFlightFading(state: PreviewFlightState) {
  return (state.status === "opening" || state.status === "closing") && state.mode === "fade"
}

/** Whether a borrowed video sits fitted in the preview, not flying, so a resize moves it with the preview. */
export function selectVideoAtRest(state: PreviewFlightState) {
  if (state.status === "open") return state.borrowed

  return (state.status === "opening" || state.status === "closing") && state.borrowed && state.mode === "fade"
}

/** Whether the preview still waits to reveal, so it is worth measuring where it would fly from. */
export function selectAwaitingReveal(state: PreviewFlightState) {
  return state.status === "pending" || state.status === "decoding"
}

/** Whether a decode of image load `attempt` is still the one the preview waits for. */
export function selectDecodeCurrent(state: PreviewFlightState, attempt: number) {
  return state.status === "decoding" && state.attempt === attempt
}

function reveal(
  state: Extract<PreviewFlightState, { status: "pending" | "decoding" }>,
  event: Exclude<PreviewFlightEvent, { type: "close.started" | "disposed" }>,
): PreviewFlightTransition {
  const cancel: readonly PreviewFlightEffect[] = state.status === "decoding" ? [{ type: "decode.cancel" }] : []
  const attempt = state.attempt + 1

  if (event.type === "src.changed") return { state: { status: "pending", attempt }, effects: cancel }

  if (event.type === "image.loaded") {
    return { state: { status: "decoding", attempt }, effects: [...cancel, { type: "decode.start", attempt }] }
  }

  if (event.type === "image.failed") return open(cancel, undefined, false)

  if (event.type === "decode.ready" && state.status === "decoding" && event.attempt === state.attempt) {
    return open(cancel, event.origin, false)
  }

  if (event.type === "video.ready" && state.status === "pending") {
    return open([{ type: "video.borrow" }], event.origin, true)
  }

  return { state, effects: NONE }
}

function open(
  before: readonly PreviewFlightEffect[],
  origin: FlightFrame | undefined,
  borrowed: boolean,
): PreviewFlightTransition {
  if (!origin)
    return { state: { status: "opening", mode: "fade", borrowed }, effects: [...before, { type: "open.fade" }] }

  return {
    state: { status: "opening", mode: "flight", borrowed },
    effects: [...before, { type: "origin.hide" }, { type: "open.flight", from: origin }],
  }
}

function close(state: PreviewFlightState, origin: FlightFrame | undefined): PreviewFlightTransition {
  if (state.status === "pending" || state.status === "decoding") {
    return {
      state: CLOSED,
      effects: [
        ...(state.status === "decoding" ? [{ type: "decode.cancel" } as const] : []),
        { type: "body.closing.acquire" },
      ],
    }
  }

  if (state.status !== "opening" && state.status !== "open") return { state, effects: NONE }
  const hidden = originHidden(state)

  const start: PreviewFlightEffect[] = [
    { type: "body.closing.acquire" },
    { type: state.borrowed ? "zoom.fit" : "zoom.settle" },
  ]

  if (!origin) {
    return {
      state: { status: "closing", mode: "fade", borrowed: state.borrowed },
      effects: [...start, ...(hidden ? [{ type: "origin.show" } as const] : []), { type: "close.fade" }],
    }
  }

  return {
    state: { status: "closing", mode: "flight", borrowed: state.borrowed },
    effects: [
      ...start,
      ...(hidden ? [] : [{ type: "origin.hide" } as const]),
      { type: "close.flight", to: origin, turn: state.status === "opening" && state.mode === "flight" },
    ],
  }
}

function settle(state: PreviewFlightState): PreviewFlightTransition {
  if (state.status === "opening") {
    return {
      state: { status: "open", originHidden: state.mode === "flight", borrowed: state.borrowed },
      effects: NONE,
    }
  }

  if (state.status !== "closing") return { state, effects: NONE }

  // A video is the surface and goes straight back; an image's stand-in fades over the page's image once it lands.
  if (state.mode === "flight" && state.borrowed) {
    return { state: CLOSED, effects: [{ type: "origin.show" }, { type: "video.return" }] }
  }

  if (state.mode === "flight") {
    return {
      state: { status: "closing", mode: "veil", borrowed: false },
      effects: [{ type: "origin.show" }, { type: "close.veil" }],
    }
  }

  return { state: CLOSED, effects: state.borrowed ? [{ type: "video.return" }] : NONE }
}

function teardown(state: PreviewFlightState): readonly PreviewFlightEffect[] {
  if (state.status === "pending" || state.status === "disposed") return NONE

  if (state.status === "decoding") return [{ type: "decode.cancel" }]

  if (state.status === "closed") return [{ type: "body.closing.release" }]

  return [
    { type: "loop.stop" },
    ...(originHidden(state) ? [{ type: "origin.show" } as const] : []),
    ...(state.borrowed ? [{ type: "video.return" } as const] : []),
    ...(state.status === "closing" ? [{ type: "body.closing.release" } as const] : []),
  ]
}

function originHidden(state: Extract<PreviewFlightState, { status: "opening" | "open" | "closing" }>) {
  if (state.status === "open") return state.originHidden

  return state.mode === "flight"
}
