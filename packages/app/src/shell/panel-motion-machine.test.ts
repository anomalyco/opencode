import { describe, expect, test } from "bun:test"
import {
  createPanelMotionState,
  selectPanelPresent,
  transitionPanelMotion,
  type PanelMotionEffect,
  type PanelMotionEvent,
  type PanelMotionState,
} from "./panel-motion-machine"

const target = (open: boolean, identity = "a", reduced = false): PanelMotionEvent => ({
  type: "target.changed",
  open,
  identity,
  reduced,
})

const replay = (events: PanelMotionEvent[], state: PanelMotionState) =>
  events.reduce<{ state: PanelMotionState; effects: PanelMotionEffect[] }>(
    (current, event) => {
      const next = transitionPanelMotion(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

// A panel the driver has reported its first target to, at rest.
const resting = (open: boolean) => replay([target(open)], createPanelMotionState(open)).state

const attempt = (state: PanelMotionState) => (state.status === "disposed" ? 0 : state.attempt)

const types = (effects: readonly PanelMotionEffect[]) => effects.map((effect) => effect.type)

describe("panel motion", () => {
  test("the first target shows its state without motion", () => {
    expect(replay([target(true)], createPanelMotionState(true)).effects).toEqual([{ type: "snap", open: true }])
  })

  test("a sync no open change follows expires, so a later close animates", () => {
    const synced = replay([{ type: "sync.requested", open: false, current: true }], resting(true))
    expect(types(synced.effects)).toEqual(["expire"])

    const closing = replay([{ type: "pending.expired" }, target(false)], synced.state)
    expect(closing.state.status).toBe("flying")
    expect(types(closing.effects)).toEqual(["fly"])
  })

  test("a sync inside the batch that closes shows the close at once", () => {
    const result = replay([{ type: "sync.requested", open: false, current: false }, target(false)], resting(true))

    expect(result.state).toMatchObject({ status: "rest", open: false })
    expect(types(result.effects)).toEqual(["expire", "snap", "closed"])
  })

  test("work queued in the batch that opens runs only once the flight lands", () => {
    const ran: string[] = []
    const queued = replay([{ type: "waiter.queued", open: true, run: () => ran.push("focus") }], resting(false))
    expect(types(queued.effects)).toEqual(["expire"])

    const flying = replay([target(true)], queued.state)
    expect(flying.state.status).toBe("flying")
    expect(types(flying.effects)).toEqual(["fly"])

    // The batch's microtask passes while the panel flies.
    const midway = replay([{ type: "pending.expired" }], flying.state)
    expect(midway.effects).toEqual([])

    const landed = replay([{ type: "flight.landed", attempt: attempt(flying.state) }], midway.state)
    expect(landed.state).toMatchObject({ status: "rest", open: true })
    expect(types(landed.effects)).toEqual(["land", "run"])
    landed.effects.forEach((effect) => effect.type === "run" && effect.waiters.forEach((waiter) => waiter()))
    expect(ran).toEqual(["focus"])
  })

  test("work queued where the panel already rests runs at once", () => {
    const run = () => {}

    expect(transitionPanelMotion(resting(true), { type: "waiter.queued", open: true, run }).effects).toEqual([
      { type: "run", waiters: [run] },
    ])
  })

  test("a flight whose frames stopped lands on the timer, and a stale timer is ignored", () => {
    const closing = replay([target(false)], resting(true)).state
    const turned = replay([target(true)], closing).state

    expect(transitionPanelMotion(turned, { type: "flight.timed-out", attempt: attempt(closing) }).state).toBe(turned)

    const landed = transitionPanelMotion(turned, { type: "flight.timed-out", attempt: attempt(turned) })
    expect(landed.state).toMatchObject({ status: "rest", open: true })
    expect(landed.effects).toEqual([{ type: "snap", open: true }, { type: "land" }])
  })

  test("a turnaround drops work queued for the abandoned direction", () => {
    const opening = replay(
      [target(true), { type: "waiter.queued", open: true, run: () => {} }, target(false)],
      resting(false),
    )

    const landed = replay([{ type: "flight.landed", attempt: attempt(opening.state) }], opening.state)
    expect(types(landed.effects)).toEqual(["land", "closed"])
    expect(selectPanelPresent(landed.state)).toBe(false)
  })

  test("another layout's state shows at once without a close or queued work", () => {
    const closing = replay([target(false), { type: "waiter.queued", open: false, run: () => {} }], resting(true))
    const switched = replay([target(false, "b")], closing.state)

    expect(switched.state).toMatchObject({ status: "rest", open: false, identity: "b" })
    expect(switched.effects).toEqual([{ type: "snap", open: false }, { type: "land" }])
  })

  test("reduced motion opens at once and fades in", () => {
    expect(types(replay([target(true, "a", true)], resting(false)).effects)).toEqual(["snap", "reveal"])
    expect(types(replay([target(false, "a", true)], resting(true)).effects)).toEqual(["snap", "closed"])
  })

  test("present until a close lands", () => {
    const closing = replay([target(false)], resting(true)).state
    expect(selectPanelPresent(closing)).toBe(true)

    const landed = transitionPanelMotion(closing, { type: "flight.landed", attempt: attempt(closing) }).state
    expect(selectPanelPresent(landed)).toBe(false)
  })

  test("disposing mid-flight stops it, and later events are ignored", () => {
    const flying = replay([target(true)], resting(false)).state
    const disposed = transitionPanelMotion(flying, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "land" }])
    expect(transitionPanelMotion(disposed.state, { type: "flight.landed", attempt: attempt(flying) }).state).toBe(
      disposed.state,
    )
  })
})
