import { describe, expect, test } from "bun:test"
import {
  acceptsGameInput,
  acceptsPointer,
  boardCloseAge,
  countHomePins,
  createPin,
  createPinBoardState,
  dragKnockDue,
  relayoutPins,
  shouldReassemble,
  transitionPinBoard,
  type PinBoardEvent,
  type PinBoardState,
} from "./pin-board-machine"

const grid = () => Array.from({ length: 6 }, (_, c) => createPin(c, 0, 2))

const run = (events: PinBoardEvent[], state: PinBoardState = createPinBoardState()) =>
  events.reduce(transitionPinBoard, state)

describe("pin board", () => {
  // A resize mid-game used to put every knocked-out brick back in its socket.
  test("a resize keeps knocked-out and flying pins where they are", () => {
    const pins = grid()
    relayoutPins(pins, 0, 0, 10)
    pins[0].phase = "out"
    pins[1].phase = "air"
    pins[1].x = 33
    pins[2].phase = "return"
    const left = countHomePins(pins)

    relayoutPins(pins, 100, 50, 8)

    expect(countHomePins(pins)).toBe(left)
    expect(pins.map((p) => p.phase)).toEqual(["out", "air", "return", "home", "home", "home"])
    expect(pins[1].x).toBe(33)
    // Socketed pins move with their sockets, and a returning pin flies to its new socket.
    expect([pins[3].x, pins[3].y]).toEqual([100 + 3.5 * 8, 50 + 0.5 * 8])
    expect([pins[2].hx, pins[2].hy]).toEqual([100 + 2.5 * 8, 50 + 0.5 * 8])
  })

  // Piles are counted per bucket of the old pitch, so piled pins drop and pile again on the new surfaces.
  test("a resize drops piled pins so they pile again", () => {
    const pins = grid()
    relayoutPins(pins, 0, 0, 10)
    pins[4].phase = "rest"
    pins[4].vx = 5
    pins[4].vy = 5

    relayoutPins(pins, 0, 0, 12)

    expect(pins[4]).toMatchObject({ phase: "air", vx: 0, vy: 0 })
  })

  // A press during the pack-up wave used to blast the returning pins back out just before the board unmounts.
  test("the closing board ignores presses, drags and game input", () => {
    const closing = run([{ type: "close", now: 10 }])
    expect(acceptsPointer(closing)).toBe(false)
    expect(boardCloseAge(closing, 10.5)).toBe(0.5)

    for (const event of [
      { type: "pointer.down", x: 1, y: 1 },
      { type: "pointer.dragged", x: 50, y: 50 },
      { type: "knocked", now: 11 },
      { type: "play" },
      { type: "restore", now: 11 },
      { type: "close", now: 11 },
    ] satisfies PinBoardEvent[])
      expect(transitionPinBoard(closing, event)).toBe(closing)
  })

  test("closing a held drag ends it", () => {
    const state = run([
      { type: "pointer.down", x: 0, y: 0 },
      { type: "close", now: 1 },
    ])

    expect(dragKnockDue(state, 100, 100, 7)).toBe(false)
  })

  test("a game takes ball input and ignores the pointer until restored", () => {
    const game = run([{ type: "play" }])
    expect(acceptsGameInput(game)).toBe(true)
    expect(acceptsPointer(game)).toBe(false)
    expect(transitionPinBoard(game, { type: "pointer.down", x: 1, y: 1 })).toBe(game)

    const restored = transitionPinBoard(game, { type: "restore", now: 20 })
    expect(restored).toEqual({ status: "interactive", dragging: false, dragX: 0, dragY: 0, knockedAt: 20 })
    // Restoring restarts the idle clock that brings loose pins home.
    expect(shouldReassemble(restored, 0, 1, 21)).toBe(false)
    expect(shouldReassemble(restored, 0, 1, 22.5)).toBe(true)
  })

  test("a drag knocks again only once it moves past the trail spacing", () => {
    const state = run([{ type: "pointer.down", x: 0, y: 0 }])
    expect(dragKnockDue(state, 8, 0, 7)).toBe(false)
    expect(dragKnockDue(state, 9, 0, 7)).toBe(true)

    const moved = transitionPinBoard(state, { type: "pointer.dragged", x: 9, y: 0 })
    expect(dragKnockDue(moved, 9, 0, 7)).toBe(false)
    expect(shouldReassemble(moved, 0, 3, 100)).toBe(false)
  })

  test("frame-loop events that change nothing keep the same state", () => {
    const idle = createPinBoardState()
    expect(transitionPinBoard(idle, { type: "pointer.up" })).toBe(idle)
    expect(transitionPinBoard(idle, { type: "pointer.dragged", x: 5, y: 5 })).toBe(idle)

    const disposed = transitionPinBoard(idle, { type: "dispose" })
    expect(disposed).toEqual({ status: "disposed" })

    for (const event of [{ type: "play" }, { type: "close", now: 1 }, { type: "dispose" }] satisfies PinBoardEvent[])
      expect(transitionPinBoard(disposed, event)).toBe(disposed)
  })
})
