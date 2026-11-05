import { describe, expect, test } from "bun:test"
import type { PinBoardHandle } from "./pin-board"
import type { LodgerBall } from "./wordmark"
import {
  createWordmarkState,
  selectBrickBreaker,
  selectPinBoard,
  selectWordmarkAnimating,
  selectWordmarkCanInteract,
  selectWordmarkDropOver,
  selectWordmarkFlatVisible,
  selectWordmarkGrip,
  selectWordmarkLifted,
  selectWordmarkLodger,
  transitionWordmark,
  type WordmarkEffect,
  type WordmarkEvent,
  type WordmarkState,
} from "./wordmark-machine"

// SAFETY: the machine only stores and hands over these handles and the logo; it never calls or reads them.
const board = { left: () => 800 } as unknown as PinBoardHandle
const ball = { radius: () => 5 } as unknown as LodgerBall
const logo = {} as HTMLDivElement

function replay(events: WordmarkEvent[], state: WordmarkState = createWordmarkState(false)) {
  return events.reduce<{ state: WordmarkState; effects: readonly WordmarkEffect[] }>(
    (step, event) => transitionWordmark(step.state, event),
    { state, effects: [] },
  )
}

const release = (distance: number, options: { nearHole?: boolean; reducedMotion?: boolean } = {}): WordmarkEvent => ({
  type: "release",
  distance,
  nearHole: options.nearHole ?? false,
  ball,
  reducedMotion: options.reducedMotion ?? false,
})
const frame = (options: { inHole?: boolean; over?: boolean; reducedMotion?: boolean }): WordmarkEvent => ({
  type: "carry.frame",
  inHole: options.inHole ?? false,
  over: options.over ?? false,
  reducedMotion: options.reducedMotion ?? false,
})
const grab: WordmarkEvent = { type: "grab" }
const mounted: WordmarkEvent = { type: "board.mounted", board }

// The lodger pulled out, the pin board mounted, and the lodger perched beside it.
const IDLE = replay([grab, { type: "drag.slip", reducedMotion: false }, mounted, { type: "settled", phase: "show" }])
  .state
const GAME = replay([grab, frame({ over: true }), release(40)], IDLE).state

describe("wordmark lodger", () => {
  test("pulling the lodger out pops the pin board, which stays mounted while the lodger perches", () => {
    const show = replay([grab, release(30)])
    expect(show.state).toEqual({ status: "show", board: undefined, cue: 0 })
    expect(selectWordmarkGrip(show.state)).toBe("none")
    expect(selectPinBoard(show.state, logo)).toEqual({ logo, entrance: "chain", closing: false })
    expect(selectWordmarkFlatVisible(show.state)).toBe(true)

    const shown = replay([mounted, { type: "cue.step", phase: "show", cue: 2 }], show.state)
    expect(selectWordmarkFlatVisible(shown.state)).toBe(false)

    expect(IDLE).toEqual({ status: "idle", board })
    expect(selectWordmarkGrip(IDLE)).toBe("idle")
    expect(selectWordmarkCanInteract(IDLE)).toBe(true)
    expect(selectWordmarkAnimating(IDLE)).toBe(false)
  })

  test("a short pull snaps the lodger back into the hole", () => {
    const snap = replay([grab, release(10)])
    expect(snap.state.status).toBe("snap")
    expect(selectWordmarkGrip(snap.state)).toBe("hidden")
    expect(selectPinBoard(snap.state, logo)).toBeUndefined()
    expect(replay([{ type: "settled", phase: "snap" }], snap.state).state.status).toBe("hidden")
  })

  // Bug: the board handle stayed in a plain object after the pin board unmounted.
  test("packing the lodger back drops the pin board and its handle", () => {
    const pack = replay([grab, frame({ inHole: true })], IDLE)
    expect(pack.state).toEqual({ status: "pack", board, cue: 0 })
    expect(selectPinBoard(pack.state, logo)).toEqual({ logo, entrance: "chain", closing: true })

    const flat = transitionWordmark(pack.state, { type: "cue.step", phase: "pack", cue: 2 })
    expect(flat.state).toEqual({ status: "pack", board: undefined, cue: 2 })
    expect(selectPinBoard(flat.state, logo)).toBeUndefined()

    expect(transitionWordmark(flat.state, { type: "settled", phase: "pack" }).state).toEqual({ status: "hidden" })
  })

  // Bug: the lodger settled at 0.7s while Brick Breaker exited until 1s; grabbing it then left it frozen in "game".
  test("the lodger stays out of reach until Brick Breaker finishes its exit", () => {
    expect(GAME).toEqual({ status: "game", board, ball, ballStage: "active" })
    expect(selectBrickBreaker(GAME)).toEqual({ board, ball })
    expect(selectWordmarkGrip(GAME)).toBe("none")

    const returning = transitionWordmark(GAME, { type: "ball.done" }).state
    expect(selectWordmarkAnimating(returning)).toBe(true)
    expect(selectWordmarkLifted(returning)).toBe(true)

    const landed = transitionWordmark(returning, { type: "settled", phase: "return" }).state
    expect(landed).toEqual({ status: "game", board, ball, ballStage: "landed" })
    expect(selectBrickBreaker(landed)).toEqual({ board, ball })
    expect(selectWordmarkGrip(landed)).toBe("none")
    expect(selectWordmarkCanInteract(landed)).toBe(false)
    expect(selectWordmarkLifted(landed)).toBe(false)
    expect(selectWordmarkAnimating(landed)).toBe(false)
    expect(transitionWordmark(landed, grab).state).toBe(landed)
    expect(transitionWordmark(landed, frame({ inHole: true })).state).toBe(landed)

    const done = transitionWordmark(landed, { type: "game.done" })
    expect(done).toEqual({ state: { status: "idle", board }, effects: [{ type: "focus.composer" }] })
    expect(selectBrickBreaker(done.state)).toBeUndefined()
    expect(selectWordmarkGrip(done.state)).toBe("idle")
  })

  test("Brick Breaker ending before the lodger lands hands it over to its flight home", () => {
    const returning = transitionWordmark(GAME, { type: "ball.done" }).state
    const done = transitionWordmark(returning, { type: "game.done" })
    expect(done).toEqual({ state: { status: "return", board }, effects: [{ type: "focus.composer" }] })
    expect(transitionWordmark(done.state, { type: "settled", phase: "return" }).state).toEqual({
      status: "idle",
      board,
    })
  })

  // Bug: reaching the hole straight from the composer returned before clearing the composer's drop highlight.
  test("flicking from the composer into the hole clears the drop highlight", () => {
    const over = replay([grab, frame({ over: true })], IDLE).state
    expect(selectWordmarkDropOver(over)).toBe(true)
    expect(transitionWordmark(over, frame({ over: true })).state).toBe(over)

    const pack = transitionWordmark(over, frame({ inHole: true, over: true })).state
    expect(pack.status).toBe("pack")
    expect(selectWordmarkDropOver(pack)).toBe(false)
  })

  test("a carried lodger hops on a tap, flies home when let go, and packs near the hole", () => {
    const carry = transitionWordmark(IDLE, grab).state
    expect(carry).toEqual({ status: "carry", board, over: false })
    expect(selectWordmarkLifted(carry)).toBe(true)

    const hop = transitionWordmark(carry, release(2)).state
    expect(hop).toEqual({ status: "hop", board, cue: 0 })
    expect(replay([{ type: "cue.step", phase: "hop", cue: 1 }, { type: "settled", phase: "hop" }], hop).state).toEqual(
      IDLE,
    )

    const home = transitionWordmark(carry, release(40)).state
    expect(home).toEqual({ status: "return", board })
    expect(transitionWordmark(home, { type: "settled", phase: "return" }).state).toEqual(IDLE)

    expect(transitionWordmark(carry, release(40, { nearHole: true })).state).toEqual({ status: "pack", board, cue: 0 })
  })

  test("dropping on the composer plays only with a pin board and motion", () => {
    const over = replay([grab, frame({ over: true })], IDLE).state
    expect(transitionWordmark(over, release(40, { reducedMotion: true })).state).toEqual(IDLE)

    const unmounted = replay([grab, { type: "drag.slip", reducedMotion: false }, { type: "settled", phase: "show" }])
    const noBoard = replay([grab, frame({ over: true }), release(40)], unmounted.state).state
    expect(noBoard).toEqual({ status: "return", board: undefined })
  })

  test("reduced motion skips every animation but still mounts and unmounts the pin board", () => {
    const idle = replay([grab, { type: "drag.slip", reducedMotion: true }])
    expect(idle.state).toEqual({ status: "idle", board: undefined })
    expect(selectPinBoard(idle.state, logo)).toBeDefined()
    expect(replay([grab, release(30, { reducedMotion: true })]).state.status).toBe("idle")
    expect(replay([grab, release(10, { reducedMotion: true })]).state.status).toBe("hidden")

    const carry = transitionWordmark(IDLE, grab).state
    expect(transitionWordmark(carry, release(2, { reducedMotion: true })).state).toEqual(IDLE)
    expect(transitionWordmark(carry, release(40, { reducedMotion: true })).state).toEqual(IDLE)
    const hidden = transitionWordmark(carry, frame({ inHole: true, reducedMotion: true })).state
    expect(hidden).toEqual({ status: "hidden" })
    expect(selectPinBoard(hidden, logo)).toBeUndefined()
  })

  test("the static pin board shows no lodger and sweeps in", () => {
    const state = createWordmarkState(true)
    expect(selectWordmarkLodger(state)).toBe(false)
    expect(selectPinBoard(state, logo)).toEqual({ logo, entrance: "sweep", closing: false })
    expect(selectPinBoard(state, undefined)).toBeUndefined()
    expect(transitionWordmark(state, mounted).state).toBe(state)
  })

  test("ignores events that do not apply to the current phase", () => {
    const hidden = createWordmarkState(false)
    for (const event of [
      release(40),
      frame({ inHole: true }),
      { type: "cue.step", phase: "show", cue: 1 },
      { type: "settled", phase: "show" },
      { type: "ball.done" },
      { type: "game.done" },
    ] satisfies WordmarkEvent[]) {
      expect(transitionWordmark(hidden, event)).toEqual({ state: hidden, effects: [] })
    }

    const show = replay([grab, release(30), { type: "cue.step", phase: "show", cue: 2 }]).state
    expect(transitionWordmark(show, { type: "cue.step", phase: "show", cue: 1 }).state).toBe(show)
    expect(transitionWordmark(show, { type: "cue.step", phase: "pack", cue: 3 }).state).toBe(show)
    expect(transitionWordmark(IDLE, mounted).state).toBe(IDLE)
  })
})
