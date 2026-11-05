import { describe, expect, test } from "bun:test"
import type { FlightFrame } from "./image-flight"
import {
  INITIAL_PREVIEW_FLIGHT_STATE,
  selectFlightInteractive,
  selectFlightStage,
  selectVideoAtRest,
  transitionPreviewFlight,
  type PreviewFlightEffect,
  type PreviewFlightEvent,
  type PreviewFlightState,
} from "./image-flight-machine"

const box = { x: 10, y: 20, width: 80, height: 60 }
const origin: FlightFrame = { image: box, clip: box, radius: 6, surface: box, surfaceRadius: 6, lift: 0 }

function replay(events: PreviewFlightEvent[], from = INITIAL_PREVIEW_FLIGHT_STATE) {
  return events.reduce(
    (result, event) => {
      const next = transitionPreviewFlight(result.state, event)

      return { state: next.state, effects: next.effects, stages: [...result.stages, selectFlightStage(next.state)] }
    },
    { state: from, effects: [] as readonly PreviewFlightEffect[], stages: [] as string[] },
  )
}

const flyingOpen: PreviewFlightEvent[] = [
  { type: "image.loaded" },
  { type: "decode.ready", attempt: 1, origin },
]

describe("image preview flight", () => {
  test("opens by flying out of a visible origin and lands at rest", () => {
    const opening = replay(flyingOpen)

    expect(opening.state).toEqual({ status: "opening", mode: "flight", borrowed: false })
    expect(opening.effects).toEqual([{ type: "decode.cancel" }, { type: "origin.hide" }, { type: "open.flight", from: origin }])
    expect(opening.stages).toEqual(["pending", "flying"])

    const open = transitionPreviewFlight(opening.state, { type: "motion.settled" })
    expect(open.state).toEqual({ status: "open", originHidden: true, borrowed: false })
    expect(selectFlightStage(open.state)).toBe("rest")
  })

  test("opens by fading without an origin, and when the image fails to load", () => {
    expect(replay([{ type: "image.loaded" }, { type: "decode.ready", attempt: 1, origin: undefined }]).effects).toEqual([
      { type: "decode.cancel" },
      { type: "open.fade" },
    ])
    const failed = replay([{ type: "image.failed" }])
    expect(failed.state).toEqual({ status: "opening", mode: "fade", borrowed: false })
    expect(failed.effects).toEqual([{ type: "open.fade" }])
    expect(selectFlightStage(failed.state)).toBe("rest")
  })

  // Bug: closing mid-flight once the origin scrolled away kept the opening flight running, left the origin hidden,
  // and its landing flipped data-stage back to "rest" in the middle of the close.
  test("a close mid-flight with the origin gone fades out, shows the origin and never returns to rest", () => {
    const opening = replay(flyingOpen).state
    const closing = replay([{ type: "close.started", origin: undefined }, { type: "motion.settled" }], opening)

    expect(transitionPreviewFlight(opening, { type: "close.started", origin: undefined }).effects).toEqual([
      { type: "body.closing.acquire" },
      { type: "zoom.settle" },
      { type: "origin.show" },
      { type: "close.fade" },
    ])
    expect(closing.stages).toEqual(["closing", "closing"])
    expect(closing.state).toEqual({ status: "closed" })
  })

  // Bug: a fading close left data-stage at "rest", so a borrowed video kept taking clicks and the window keys and
  // wheel stayed captured for the whole exit.
  test("a fading close of a video stops taking input and hands the video back once it fades", () => {
    const open = replay([{ type: "video.ready", origin }, { type: "motion.settled" }]).state
    const closing = transitionPreviewFlight(open, { type: "close.started", origin: undefined })

    expect(closing.effects).toEqual([
      { type: "body.closing.acquire" },
      { type: "zoom.fit" },
      { type: "origin.show" },
      { type: "close.fade" },
    ])
    expect(selectFlightStage(closing.state)).toBe("closing")
    expect(selectFlightInteractive(closing.state)).toBe(false)
    expect(selectVideoAtRest(closing.state)).toBe(true)
    expect(transitionPreviewFlight(closing.state, { type: "motion.settled" })).toEqual({
      state: { status: "closed" },
      effects: [{ type: "video.return" }],
    })
  })

  // Bug: reveal awaited decode with no claim, so a decode that settled after the image changed revealed it anyway.
  test("a decode of an image that changed or loaded again is ignored", () => {
    const reloaded = replay([{ type: "image.loaded" }, { type: "src.changed" }, { type: "image.loaded" }])

    expect(reloaded.state).toEqual({ status: "decoding", attempt: 3 })
    expect(reloaded.effects).toEqual([{ type: "decode.start", attempt: 3 }])

    const stale = transitionPreviewFlight(reloaded.state, { type: "decode.ready", attempt: 1, origin })
    expect(stale.state).toBe(reloaded.state)
    expect(stale.effects).toEqual([])
    expect(transitionPreviewFlight(reloaded.state, { type: "decode.ready", attempt: 3, origin }).state.status).toBe(
      "opening",
    )

    const again = transitionPreviewFlight({ status: "decoding", attempt: 1 }, { type: "image.loaded" })
    expect(again.effects).toEqual([{ type: "decode.cancel" }, { type: "decode.start", attempt: 2 }])
  })

  test("a close before the preview reveals ends it there, and a late decode is ignored", () => {
    const closed = replay([{ type: "image.loaded" }, { type: "close.started", origin }])

    expect(closed.state).toEqual({ status: "closed" })
    expect(closed.effects).toEqual([{ type: "decode.cancel" }, { type: "body.closing.acquire" }])
    expect(transitionPreviewFlight(closed.state, { type: "decode.ready", attempt: 1, origin }).state).toBe(closed.state)
  })

  test("a close mid-flight with the origin in sight turns the flight around, then veils the stand-in", () => {
    const opening = replay(flyingOpen).state
    const turned = transitionPreviewFlight(opening, { type: "close.started", origin })

    expect(turned.effects).toEqual([
      { type: "body.closing.acquire" },
      { type: "zoom.settle" },
      { type: "close.flight", to: origin, turn: true },
    ])

    const landed = transitionPreviewFlight(turned.state, { type: "motion.settled" })
    expect(landed.state).toEqual({ status: "closing", mode: "veil", borrowed: false })
    expect(landed.effects).toEqual([{ type: "origin.show" }, { type: "close.veil" }])
    expect(selectFlightStage(landed.state)).toBe("flying")
    expect(transitionPreviewFlight(landed.state, { type: "motion.settled" }).state).toEqual({ status: "closed" })
  })

  test("a close from a fade-opened preview hides the origin and flies home from rest", () => {
    const open = replay([{ type: "image.failed" }, { type: "motion.settled" }]).state

    expect(transitionPreviewFlight(open, { type: "close.started", origin }).effects).toEqual([
      { type: "body.closing.acquire" },
      { type: "zoom.settle" },
      { type: "origin.hide" },
      { type: "close.flight", to: origin, turn: false },
    ])
  })

  test("a video flying home is handed back as it lands", () => {
    const open = replay([{ type: "video.ready", origin }, { type: "motion.settled" }]).state
    const closing = transitionPreviewFlight(open, { type: "close.started", origin })

    expect(closing.effects.at(-1)).toEqual({ type: "close.flight", to: origin, turn: false })
    expect(transitionPreviewFlight(closing.state, { type: "motion.settled" })).toEqual({
      state: { status: "closed" },
      effects: [{ type: "origin.show" }, { type: "video.return" }],
    })
  })

  // A throttled frame loop can let the dialog unmount before the close lands.
  test("disposal tears down what each phase holds, once", () => {
    const flying: PreviewFlightState = { status: "closing", mode: "flight", borrowed: true }

    expect(transitionPreviewFlight(flying, { type: "disposed" }).effects).toEqual([
      { type: "loop.stop" },
      { type: "origin.show" },
      { type: "video.return" },
      { type: "body.closing.release" },
    ])
    expect(transitionPreviewFlight({ status: "closed" }, { type: "disposed" }).effects).toEqual([
      { type: "body.closing.release" },
    ])
    expect(transitionPreviewFlight({ status: "decoding", attempt: 2 }, { type: "disposed" }).effects).toEqual([
      { type: "decode.cancel" },
    ])

    const disposed = transitionPreviewFlight(flying, { type: "disposed" }).state
    expect(transitionPreviewFlight(disposed, { type: "motion.settled" }).state).toBe(disposed)
    expect(transitionPreviewFlight(disposed, { type: "disposed" }).effects).toEqual([])
  })
})
