import { expect, test } from "bun:test"
import {
  createArrivalGuardState,
  selectArrivalGuard,
  transitionArrivalGuard,
  type ArrivalGuardEvent,
} from "./arrival-guard-machine"

const replay = (events: readonly ArrivalGuardEvent[], state = createArrivalGuardState()) =>
  events.reduce((current, event) => transitionArrivalGuard(current, event).state, state)

test("a file an agent selects takes no input until the delay after the person can see it", () => {
  const arrived = replay([{ type: "arrived", key: "a" }])
  const token = selectArrivalGuard(arrived, "a") ?? -1
  expect(token).toBe(1)
  expect(selectArrivalGuard(arrived, "b")).toBeUndefined()

  // Another tab on show starts nothing; this tab starts the delay once.
  expect(transitionArrivalGuard(arrived, { type: "shown", key: "b" })).toEqual({ state: arrived, effects: [] })
  const shown = transitionArrivalGuard(arrived, { type: "shown", key: "a" })
  expect(shown.effects).toEqual([{ type: "expire", token }])
  expect(selectArrivalGuard(shown.state, "a")).toBe(token)
  expect(transitionArrivalGuard(shown.state, { type: "shown", key: "a" })).toEqual({ state: shown.state, effects: [] })

  expect(selectArrivalGuard(replay([{ type: "elapsed", token }], shown.state), "a")).toBeUndefined()
})

test("an old timer or one that never started cannot end a newer guard", () => {
  const first = replay([{ type: "arrived", key: "a" }, { type: "shown", key: "a" }])
  const second = replay([{ type: "arrived", key: "b" }], first)
  expect(selectArrivalGuard(second, "a")).toBeUndefined()
  expect(selectArrivalGuard(second, "b")).toBe(2)
  // The first arrival's timer fires, and a timer for the waiting guard was never started.
  expect(transitionArrivalGuard(second, { type: "elapsed", token: 1 }).state).toBe(second)
  expect(transitionArrivalGuard(second, { type: "elapsed", token: 2 }).state).toBe(second)
})

test("the person's own selection ends the guard, and nothing changes without one", () => {
  const arrived = replay([{ type: "arrived", key: "a" }])
  expect(selectArrivalGuard(replay([{ type: "left" }], arrived), "a")).toBeUndefined()
  const none = createArrivalGuardState()

  for (const event of [{ type: "shown", key: "a" }, { type: "elapsed", token: 1 }, { type: "left" }] as const)
    expect(transitionArrivalGuard(none, event).state).toBe(none)
})
