import { describe, expect, test } from "bun:test"
import {
  BRICK_BREAKER_TIMING,
  acceptsBrickBreakerInput,
  brickBreakerSpares,
  createBrickBreakerState,
  transitionBrickBreaker,
  type BrickBreakerEvent,
  type BrickBreakerState,
} from "./brick-breaker-machine"

const frame = (now: number): BrickBreakerEvent => ({ type: "frame", now })

const launch: BrickBreakerEvent = { type: "launch" }

const run = (events: BrickBreakerEvent[], state: BrickBreakerState = createBrickBreakerState(0)) =>
  events.reduce(transitionBrickBreaker, state)

// Serving at 1, so a rally runs from there.
const playing = () => run([frame(0.4), frame(1), launch])

describe("brick breaker", () => {
  test("the composer shrinks into the paddle, the ball lands on it, and a serve starts play", () => {
    const entering = createBrickBreakerState(0)
    const landed = transitionBrickBreaker(entering, frame(BRICK_BREAKER_TIMING.enterLand))
    const serving = transitionBrickBreaker(landed, frame(BRICK_BREAKER_TIMING.enter))

    expect(transitionBrickBreaker(entering, frame(0.2))).toBe(entering)
    expect(landed).toEqual({ status: "enter", startedAt: 0, landed: true })
    expect(serving).toEqual({ status: "serve", startedAt: BRICK_BREAKER_TIMING.enter, landed: true, lives: 3 })
    expect(transitionBrickBreaker(serving, launch)).toEqual({ status: "play", lives: 3 })
  })

  // Before, the frame that cleared the last brick went on to the exit step with the rally's elapsed time, so after any
  // rally over a second the paddle snapped back into the composer and the game ended in that same frame.
  test("clearing the last brick after a long rally plays the whole exit morph", () => {
    const won = transitionBrickBreaker(playing(), { type: "cleared", now: 25 })

    expect(won).toEqual({ status: "exit", startedAt: 25, kind: "win" })
    expect(acceptsBrickBreakerInput(won)).toBe(false)
    expect(transitionBrickBreaker(won, frame(25.5))).toBe(won)
    expect(transitionBrickBreaker(won, frame(26))).toEqual({ status: "disposed" })
  })

  // Before, the frame that lost the ball went on to the miss step with the rally's elapsed time, so after a rally over
  // 0.55 s the pause was skipped: a life went at once, and on the last life the exit morph was skipped too.
  test("missing after a long rally pauses before taking a life", () => {
    const missed = transitionBrickBreaker(playing(), { type: "missed", now: 15 })

    expect(missed).toEqual({ status: "miss", startedAt: 15, lives: 3 })
    expect(transitionBrickBreaker(missed, frame(15.2))).toBe(missed)
    expect(transitionBrickBreaker(missed, frame(15.56))).toEqual({
      status: "serve",
      startedAt: 15.56,
      landed: false,
      lives: 2,
    })
  })

  test("the last miss pauses, then plays the whole exit morph", () => {
    const last: BrickBreakerState = { status: "miss", startedAt: 30, lives: 1 }
    const lost = transitionBrickBreaker(last, frame(30.56))

    expect(transitionBrickBreaker(last, frame(30.5))).toBe(last)
    expect(lost).toEqual({ status: "exit", startedAt: 30.56, kind: "lose" })
    expect(transitionBrickBreaker(lost, frame(31.2))).toBe(lost)
    expect(transitionBrickBreaker(lost, frame(31.6))).toEqual({ status: "disposed" })
  })

  test("a ball dropping back onto the paddle cannot be served until it lands", () => {
    const dropping: BrickBreakerState = { status: "serve", startedAt: 10, landed: false, lives: 2 }
    const landed = transitionBrickBreaker(dropping, frame(10.43))

    expect(transitionBrickBreaker(dropping, launch)).toBe(dropping)
    expect(transitionBrickBreaker(dropping, frame(10.3))).toBe(dropping)
    expect(landed).toEqual({ ...dropping, landed: true })
    expect(transitionBrickBreaker(landed, launch)).toEqual({ status: "play", lives: 2 })
    expect(brickBreakerSpares(landed)).toBe(1)
  })

  test("Escape quits from every phase, once", () => {
    const states: BrickBreakerState[] = [
      createBrickBreakerState(0),
      run([frame(1)]),
      playing(),
      transitionBrickBreaker(playing(), { type: "missed", now: 4 }),
    ]

    states.forEach((state) =>
      expect(transitionBrickBreaker(state, { type: "quit", now: 5 })).toEqual({
        status: "exit",
        startedAt: 5,
        kind: "quit",
      }),
    )

    const quit = transitionBrickBreaker(playing(), { type: "quit", now: 5 })
    expect(transitionBrickBreaker(quit, { type: "quit", now: 5.5 })).toBe(quit)
    expect(transitionBrickBreaker(quit, { type: "missed", now: 5.5 })).toBe(quit)
  })

  test("frames that cross no threshold keep the same state, including a frame stamped before the phase began", () => {
    const entering = createBrickBreakerState(10)
    const rally = playing()

    expect(transitionBrickBreaker(entering, frame(9.992))).toBe(entering)
    expect(transitionBrickBreaker(rally, frame(100))).toBe(rally)
    expect(transitionBrickBreaker(rally, launch)).toBe(rally)
  })

  test("unmounting ends the game from any phase and ignores everything after", () => {
    const disposed = transitionBrickBreaker(playing(), { type: "dispose" })

    expect(disposed).toEqual({ status: "disposed" })
    expect(transitionBrickBreaker(createBrickBreakerState(0), { type: "dispose" })).toBe(disposed)

    for (const event of [frame(50), launch, { type: "quit", now: 50 }] satisfies BrickBreakerEvent[])
      expect(transitionBrickBreaker(disposed, event)).toBe(disposed)
  })
})
