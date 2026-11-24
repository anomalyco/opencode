import { expect, test } from "bun:test"
import type { Place } from "./place"
import {
  createPlaceReturnState,
  PLACE_LEFT_EVENT,
  PLACE_RENDERED_EVENT,
  PLACE_TAKEN_EVENT,
  returningPlace,
  transitionPlaceReturn,
  type PlaceReturnEvent,
  type PlaceReturnState,
  type PlaceReturnTransition,
} from "./place-machine"

const place: Place = { key: "e", offset: 40, after: ["f"], before: ["d"] }

const other: Place = { key: "k", offset: 0, after: [], before: ["j"] }

const returned = (to: Place = place): PlaceReturnEvent => ({ type: "returned", place: to })

const looked = (state: PlaceReturnState, end = false): PlaceReturnEvent => ({
  type: "looked",
  attempt: state.attempt,
  end,
})

function replay(events: readonly PlaceReturnEvent[]) {
  return events.reduce<PlaceReturnTransition>((current, event) => transitionPlaceReturn(current.state, event), {
    state: createPlaceReturnState(),
    effects: [],
  })
}

test("puts the view at its place at once, then on each frame and after each batch of sizes until the time is up", () => {
  const start = replay([returned()])
  expect(start.state).toEqual({ status: "returning", attempt: 1, place })
  expect(start.effects).toEqual([
    { type: "timer.start", attempt: 1 },
    { type: "look", attempt: 1, place },
  ])

  // Its row may not be in the page yet, and the header may not have settled: the next frame looks again.
  const held = transitionPlaceReturn(start.state, looked(start.state))
  expect(held.state).toBe(start.state)
  expect(held.effects).toEqual([{ type: "frame.schedule", attempt: 1 }])
  expect(transitionPlaceReturn(held.state, PLACE_RENDERED_EVENT).effects).toEqual([{ type: "look", attempt: 1, place }])

  const done = transitionPlaceReturn(held.state, { type: "timeout", attempt: 1 })
  expect(done.state).toEqual({ status: "resting", attempt: 2 })
  expect(done.effects).toEqual([{ type: "cancel" }])
})

test("a reader who moves the view themselves keeps it from a place it had not reached", () => {
  const start = replay([returned()])
  const returning = transitionPlaceReturn(start.state, looked(start.state))
  const taken = transitionPlaceReturn(returning.state, PLACE_TAKEN_EVENT)
  expect(taken.state).toEqual({ status: "resting", attempt: 2 })
  expect(taken.effects).toEqual([{ type: "cancel" }])

  // The frame that was asked for, a batch of sizes, a late look and the timer move nothing.
  for (const event of [PLACE_RENDERED_EVENT, looked(returning.state), { type: "timeout", attempt: 1 } as const]) {
    const next = transitionPlaceReturn(taken.state, event)
    expect(next.state).toBe(taken.state)
    expect(next.effects).toEqual([])
  }
})

test("a return whose passage is gone ends where the view went, at the end", () => {
  const returning = replay([returned()])
  const end = transitionPlaceReturn(returning.state, looked(returning.state, true))
  expect(end.state).toEqual({ status: "resting", attempt: 2 })
  expect(end.effects).toEqual([{ type: "cancel" }])
})

test("a view that goes away before it arrived still has the place it was going to", () => {
  const returning = replay([returned()])
  expect(returningPlace(returning.state)).toBe(place)

  const left = transitionPlaceReturn(returning.state, PLACE_LEFT_EVENT)
  expect(left.state).toEqual({ status: "resting", attempt: 2 })
  expect(left.effects).toEqual([{ type: "cancel" }])
  expect(returningPlace(left.state)).toBeUndefined()
})

test("a second return takes over from the first, whose look and timer no longer count", () => {
  const first = replay([returned()])
  const second = transitionPlaceReturn(first.state, returned(other))
  expect(second.state).toEqual({ status: "returning", attempt: 2, place: other })
  expect(second.effects).toEqual([
    { type: "cancel" },
    { type: "timer.start", attempt: 2 },
    { type: "look", attempt: 2, place: other },
  ])

  for (const event of [looked(first.state, true), { type: "timeout", attempt: 1 } as const]) {
    const stale = transitionPlaceReturn(second.state, event)
    expect(stale.state).toBe(second.state)
    expect(stale.effects).toEqual([])
  }
})

test("a view that comes back without a place stays where it is", () => {
  const resting = createPlaceReturnState()
  const next = transitionPlaceReturn(resting, { type: "returned", place: undefined })
  expect(next.state).toBe(resting)
  expect(next.effects).toEqual([])
})
