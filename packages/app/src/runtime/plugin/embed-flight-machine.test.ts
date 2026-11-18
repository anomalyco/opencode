import { describe, expect, test } from "bun:test"
import {
  createEmbedStillState,
  DISPOSED_FLIGHT_STATE,
  DISPOSED_STILL_STATE,
  FLIGHT_LANDING_DELAY_MS,
  INITIAL_FLIGHT_STATE,
  selectFlightStill,
  selectStillOnscreen,
  selectStillUnchanged,
  STILL_CAPTURE_TIMEOUT_MS,
  STILL_INITIAL_PAUSE_MS,
  STILL_MAX_PAUSE_MS,
  STILL_SETTLE_DELAY_MS,
  transitionEmbedFlight,
  transitionEmbedStill,
  type EmbedFlightEvent,
  type EmbedFlightState,
  type EmbedPlacement,
  type EmbedStillEffect,
  type EmbedStillEvent,
  type EmbedStillState,
} from "./embed-flight-machine"

const box: EmbedPlacement = { id: "embed-Alpha", x: 0.25, y: 0, width: 640, height: 360 }

const placed = (placement: EmbedPlacement = box, page: string | undefined = "p1"): EmbedStillEvent => ({
  type: "placement.changed",
  placement,
  page,
})

const initial = createEmbedStillState({ id: "embed-Alpha", page: "p1", focused: true, reducedMotion: false })

function replay(events: EmbedStillEvent[], state: EmbedStillState = initial) {
  return events.reduce<{ state: EmbedStillState; effects: EmbedStillEffect[] }>(
    (current, event) => {
      const next = transitionEmbedStill(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function attempt(state: EmbedStillState) {
  if (state.status !== "warming" && state.status !== "capturing") throw new Error(`No attempt in ${state.status}`)

  return state.attempt
}

// The view settled on screen and its first still is being taken.
const capturing = (() => {
  const warming = replay([placed()]).state

  return transitionEmbedStill(warming, { type: "warm.due", attempt: attempt(warming) }).state
})()

const kept = transitionEmbedStill(capturing, {
  type: "capture.decoded",
  attempt: attempt(capturing),
  url: "blob:p1",
  bytes: 999,
}).state

function flight(state: EmbedFlightState, events: Omit<Extract<EmbedFlightEvent, { type: "sync" }>, "type">[]) {
  return events.reduce<{ state: EmbedFlightState; effects: unknown[] }>(
    (current, event) => {
      const next = transitionEmbedFlight(current.state, { type: "sync", ...event })

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("bug replays", () => {
  test("a navigation during a capture lets the pre-flight still capture at once and keeps the late one out", () => {
    const navigated = transitionEmbedStill(capturing, { type: "target.changed", id: "embed-Alpha", page: "p2" })
    expect(navigated.state).toMatchObject({ status: "warming", page: "p2", pause: STILL_INITIAL_PAUSE_MS })
    expect(navigated.effects).toEqual([
      { type: "capture-timer.stop" },
      { type: "warm-timer.start", attempt: attempt(navigated.state), delayMs: STILL_SETTLE_DELAY_MS },
    ])

    const flying = transitionEmbedStill(navigated.state, { type: "motion.changed", moving: true })
    expect(flying.state).toMatchObject({
      status: "capturing",
      target: { ...box, page: "p2" },
    })
    expect(flying.effects).toContainEqual({ type: "capture", attempt: attempt(flying.state), id: "embed-Alpha" })

    const late = transitionEmbedStill(flying.state, {
      type: "capture.decoded",
      attempt: attempt(capturing),
      url: "blob:p1",
      bytes: 999,
    })

    expect(late.state).toBe(flying.state)
    expect(late.effects).toEqual([{ type: "url.revoke", url: "blob:p1" }])
  })

  test("another embed without a page drops the previous still and its backoff", () => {
    if (kept.status !== "warming" || !kept.kept) throw new Error("Expected a kept still")
    const state = { ...kept, page: undefined, pause: STILL_MAX_PAUSE_MS, kept: { ...kept.kept, page: undefined } }
    const next = transitionEmbedStill(state, { type: "target.changed", id: "embed-Beta", page: undefined })
    expect(next.state).toMatchObject({
      status: "idle",
      id: "embed-Beta",
      pause: STILL_INITIAL_PAUSE_MS,
      kept: undefined,
      onscreen: undefined,
    })
    expect(next.effects).toContainEqual({ type: "url.revoke", url: "blob:p1" })
  })

  test("the window refocusing during a capture takes the next still at once", () => {
    const refocused = replay(
      [
        { type: "focus.changed", focused: false },
        { type: "focus.changed", focused: true },
      ],
      capturing,
    ).state

    expect(refocused).toMatchObject({ status: "capturing", urgent: true })

    const next = transitionEmbedStill(refocused, { type: "capture.unchanged", attempt: attempt(refocused) })
    expect(next.state).toMatchObject({ status: "warming", urgent: false })
    expect(next.effects).toContainEqual({ type: "warm-timer.start", attempt: attempt(next.state), delayMs: 0 })
  })

  test("a resized view never counts as unchanged, so its still is decoded at the new size", () => {
    const resized = replay([placed({ ...box, width: 480 })], kept).state
    const sampling = transitionEmbedStill(resized, { type: "warm.due", attempt: attempt(resized) }).state
    expect(selectStillUnchanged(sampling, attempt(sampling), 999)).toBe(false)

    const same = transitionEmbedStill(kept, { type: "warm.due", attempt: attempt(kept) }).state
    expect(selectStillUnchanged(same, attempt(same), 999)).toBe(true)
    expect(selectStillUnchanged(same, attempt(same), 998)).toBe(false)
  })
})

describe("sampling", () => {
  test("an unchanged page waits twice as long each time, up to the cap, and a change resets the wait", () => {
    const pauses: number[] = []
    let state = kept

    for (let index = 0; index < 6; index++) {
      const sampling = transitionEmbedStill(state, { type: "warm.due", attempt: attempt(state) }).state
      const next = transitionEmbedStill(sampling, { type: "capture.unchanged", attempt: attempt(sampling) })
      const timer = next.effects.find((effect) => effect.type === "warm-timer.start")
      pauses.push(timer?.type === "warm-timer.start" ? timer.delayMs : -1)
      state = next.state
    }

    expect(pauses).toEqual([6_000, 12_000, 24_000, 48_000, 60_000, 60_000])

    for (const settled of ["capture.failed", "capture.timeout"] as const) {
      const sampling = transitionEmbedStill(state, { type: "warm.due", attempt: attempt(state) }).state
      const next = transitionEmbedStill(sampling, { type: settled, attempt: attempt(sampling) })
      expect(next.state).toMatchObject({ status: "warming", pause: STILL_INITIAL_PAUSE_MS, kept: { url: "blob:p1" } })
      expect(next.effects).toContainEqual({
        type: "warm-timer.start",
        attempt: attempt(next.state),
        delayMs: STILL_INITIAL_PAUSE_MS,
      })
    }
  })

  test("a newer still replaces the kept one and gives up its URL", () => {
    const sampling = transitionEmbedStill(kept, { type: "warm.due", attempt: attempt(kept) }).state
    expect(transitionEmbedStill(sampling, { type: "capture.timeout", attempt: attempt(sampling) }).effects).toEqual([
      expect.objectContaining({ type: "warm-timer.start" }),
    ])

    const next = transitionEmbedStill(sampling, {
      type: "capture.decoded",
      attempt: attempt(sampling),
      url: "blob:p1-new",
      bytes: 1000,
    })

    expect(next.state).toMatchObject({ kept: { url: "blob:p1-new", bytes: 1000, page: "p1", ...box } })
    expect(next.effects).toEqual([
      { type: "capture-timer.stop" },
      { type: "url.revoke", url: "blob:p1" },
      { type: "warm-timer.start", attempt: attempt(next.state), delayMs: STILL_INITIAL_PAUSE_MS },
    ])
  })

  test("a capture that hangs times out and sampling goes on", () => {
    expect(capturing).toMatchObject({ status: "capturing" })
    expect(replay([placed()]).effects).toEqual([
      { type: "warm-timer.start", attempt: 1, delayMs: STILL_SETTLE_DELAY_MS },
    ])
    expect(transitionEmbedStill(replay([placed()]).state, { type: "warm.due", attempt: 1 }).effects).toEqual([
      { type: "capture", attempt: 2, id: "embed-Alpha" },
      { type: "capture-timer.start", attempt: 2, delayMs: STILL_CAPTURE_TIMEOUT_MS },
    ])

    const timedOut = transitionEmbedStill(capturing, { type: "capture.timeout", attempt: attempt(capturing) })
    expect(timedOut.state).toMatchObject({ status: "warming", kept: undefined })
    expect(timedOut.effects).toEqual([
      { type: "warm-timer.start", attempt: attempt(timedOut.state), delayMs: STILL_INITIAL_PAUSE_MS },
    ])
  })

  test("a blurred window or reduced motion stops sampling, and its end resumes it", () => {
    const warming = replay([placed()]).state

    for (const event of [
      { type: "focus.changed", focused: false },
      { type: "reduced-motion.changed", reducedMotion: true },
    ] as const) {
      const stopped = transitionEmbedStill(warming, event)
      expect(stopped.state.status).toBe("idle")
      expect(stopped.effects).toEqual([{ type: "warm-timer.stop" }])

      // A capture already in flight finishes, but schedules nothing after it.
      const busy = transitionEmbedStill(capturing, event).state
      const settled = transitionEmbedStill(busy, { type: "capture.failed", attempt: attempt(busy) })
      expect(settled.state.status).toBe("idle")
      expect(settled.effects).toEqual([{ type: "capture-timer.stop" }])
    }

    const reduced = transitionEmbedStill(warming, { type: "reduced-motion.changed", reducedMotion: true }).state
    const resumed = transitionEmbedStill(reduced, { type: "reduced-motion.changed", reducedMotion: false })
    expect(resumed.effects).toEqual([
      { type: "warm-timer.start", attempt: attempt(resumed.state), delayMs: STILL_SETTLE_DELAY_MS },
    ])

    const blurred = transitionEmbedStill(warming, { type: "focus.changed", focused: false }).state
    const focused = transitionEmbedStill(blurred, { type: "focus.changed", focused: true })
    expect(focused.effects).toEqual([{ type: "warm-timer.start", attempt: attempt(focused.state), delayMs: 0 }])
  })

  test("a flight that starts on screen captures before the view hides, and the capture outlives the hide", () => {
    const warming = replay([placed()]).state
    const moving = transitionEmbedStill(warming, { type: "motion.changed", moving: true })
    expect(moving.effects).toEqual([
      { type: "warm-timer.stop" },
      { type: "capture", attempt: attempt(moving.state), id: "embed-Alpha" },
      { type: "capture-timer.start", attempt: attempt(moving.state), delayMs: STILL_CAPTURE_TIMEOUT_MS },
    ])

    const hidden = transitionEmbedStill(moving.state, { type: "offscreen" })
    expect(hidden.state).toMatchObject({ status: "capturing", onscreen: undefined })
    expect(selectStillOnscreen(hidden.state)).toBe(false)
    expect(transitionEmbedStill(hidden.state, { type: "offscreen" }).state).toBe(hidden.state)

    const decoded = transitionEmbedStill(hidden.state, {
      type: "capture.decoded",
      attempt: attempt(hidden.state),
      url: "blob:p1",
      bytes: 999,
    })

    expect(decoded.state).toMatchObject({ status: "idle", kept: { url: "blob:p1" } })
    expect(decoded.effects).toEqual([{ type: "capture-timer.stop" }])

    // Off screen, a flight captures nothing and shows the kept still.
    const quiet = transitionEmbedStill(replay([{ type: "motion.changed", moving: false }], decoded.state).state, {
      type: "motion.changed",
      moving: true,
    })

    expect(quiet.effects).toEqual([])
  })
})

describe("flight", () => {
  test("a close flies the still out and lands straight to idle", () => {
    const close = flight(INITIAL_FLIGHT_STATE, [
      { moving: true, visible: true, onscreen: true },
      { moving: true, visible: false, onscreen: false },
    ])

    expect(close.state.status).toBe("flying")
    expect(flight(close.state, [{ moving: false, visible: false, onscreen: false }]).state.status).toBe("idle")
  })

  test("an open shows the still until the view paints, and moving again cancels the landing", () => {
    const open = flight(INITIAL_FLIGHT_STATE, [
      { moving: true, visible: true, onscreen: false },
      { moving: false, visible: true, onscreen: false },
    ])

    expect(open.state).toEqual({ status: "landing", issued: 1, attempt: 1 })
    expect(open.effects).toEqual([{ type: "landing-timer.start", attempt: 1, delayMs: FLIGHT_LANDING_DELAY_MS }])

    const again = transitionEmbedFlight(open.state, { type: "sync", moving: true, visible: true, onscreen: true })
    expect(again.state.status).toBe("flying")
    expect(again.effects).toEqual([{ type: "landing-timer.stop" }])
    expect(transitionEmbedFlight(again.state, { type: "landing.settled", attempt: 1 }).state).toBe(again.state)

    const landed = transitionEmbedFlight(open.state, { type: "landing.settled", attempt: 1 })
    expect(landed.state).toEqual({ status: "idle", issued: 1 })
  })

  test("panel motion elsewhere leaves a hidden box alone", () => {
    const next = transitionEmbedFlight(INITIAL_FLIGHT_STATE, {
      type: "sync",
      moving: true,
      visible: false,
      onscreen: false,
    })

    expect(next.state).toBe(INITIAL_FLIGHT_STATE)
  })

  test("only a flying or landing box shows the kept still, and only for its embed and page", () => {
    const flying: EmbedFlightState = { status: "flying", issued: 0 }
    expect(selectFlightStill(flying, kept, "embed-Alpha", "p1")).toMatchObject({ url: "blob:p1" })
    expect(selectFlightStill(INITIAL_FLIGHT_STATE, kept, "embed-Alpha", "p1")).toBeUndefined()
    expect(selectFlightStill(flying, kept, "embed-Alpha", "p2")).toBeUndefined()
    expect(selectFlightStill(flying, kept, "embed-Beta", "p1")).toBeUndefined()
  })
})

describe("disposal", () => {
  test("stops the active timers, gives up the kept still, and gives up a late one", () => {
    const sampling = transitionEmbedStill(kept, { type: "warm.due", attempt: attempt(kept) }).state
    expect(transitionEmbedStill(sampling, { type: "disposed" })).toEqual({
      state: DISPOSED_STILL_STATE,
      effects: [{ type: "capture-timer.stop" }, { type: "url.revoke", url: "blob:p1" }],
    })
    expect(transitionEmbedStill(kept, { type: "disposed" }).effects).toEqual([
      { type: "warm-timer.stop" },
      { type: "url.revoke", url: "blob:p1" },
    ])

    const late = transitionEmbedStill(DISPOSED_STILL_STATE, {
      type: "capture.decoded",
      attempt: 1,
      url: "blob:late",
      bytes: 1,
    })

    expect(late.effects).toEqual([{ type: "url.revoke", url: "blob:late" }])
    expect(transitionEmbedStill(DISPOSED_STILL_STATE, placed()).state).toBe(DISPOSED_STILL_STATE)

    const landing: EmbedFlightState = { status: "landing", issued: 1, attempt: 1 }
    expect(transitionEmbedFlight(landing, { type: "disposed" })).toEqual({
      state: DISPOSED_FLIGHT_STATE,
      effects: [{ type: "landing-timer.stop" }],
    })
  })
})
