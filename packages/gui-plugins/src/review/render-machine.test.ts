import { describe, expect, test } from "bun:test"
import {
  INITIAL_REVIEW_RENDER_STATE,
  reviewMobileReady,
  reviewPanelReady,
  transitionReviewRender,
  type ReviewRenderEffect,
  type ReviewRenderEvent,
  type ReviewRenderState,
} from "./render-machine"

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: ReviewRenderState, ...events: ReviewRenderEvent[]) {
  return events.reduce<{ state: ReviewRenderState; effects: readonly ReviewRenderEffect[] }>(
    (result, event) => {
      const next = transitionReviewRender(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function visit(visitID: number): ReviewRenderEvent {
  return { type: "visit.synced", visitID }
}

function settled(attempt: number): ReviewRenderEvent {
  return { type: "frame.settled", attempt }
}

describe("the first visit", () => {
  test("waits one paint, then renders both reviews", () => {
    const deferring = play(INITIAL_REVIEW_RENDER_STATE, visit(1))

    expect(deferring.effects).toEqual([{ type: "frame.schedule", attempt: 1 }])
    expect(reviewPanelReady(deferring.state)).toBe(false)
    expect(reviewMobileReady(deferring.state)).toBe(false)

    const ready = play(deferring.state, settled(1))

    expect(reviewPanelReady(ready.state)).toBe(true)
    expect(reviewMobileReady(ready.state)).toBe(true)
  })

  // A panel that mounts before the route publishes its session settled against the route's older visit, so the
  // review compared that visit with the published one and stayed blank forever.
  test("a panel mounted before the route publishes the visit stays rendered once it does", () => {
    const ready = play(INITIAL_REVIEW_RENDER_STATE, visit(1), settled(1)).state
    const published = transitionReviewRender(ready, visit(1))

    expect(published.state).toBe(ready)
    expect(published.effects).toEqual([])
    expect(reviewPanelReady(published.state)).toBe(true)
    expect(reviewMobileReady(published.state)).toBe(true)
  })

  test("a switch before the first paint waits for the newest visit's frame", () => {
    const switched = play(INITIAL_REVIEW_RENDER_STATE, visit(1), visit(2))

    expect(switched.effects).toEqual([
      { type: "frame.schedule", attempt: 1 },
      { type: "frame.cancel" },
      { type: "frame.schedule", attempt: 2 },
    ])
    expect(reviewPanelReady(switched.state)).toBe(false)
    expect(transitionReviewRender(switched.state, settled(1)).state).toBe(switched.state)
    expect(reviewPanelReady(play(switched.state, settled(2)).state)).toBe(true)
  })
})

describe("a later visit", () => {
  test("keeps the wide panel mounted while the narrow review waits one paint (#35074)", () => {
    const ready = play(INITIAL_REVIEW_RENDER_STATE, visit(1), settled(1)).state
    const switched = play(ready, visit(2))

    expect(switched.effects).toEqual([{ type: "frame.schedule", attempt: 2 }])
    expect(reviewPanelReady(switched.state)).toBe(true)
    expect(reviewMobileReady(switched.state)).toBe(false)

    const settledAgain = play(switched.state, settled(2))

    expect(reviewMobileReady(settledAgain.state)).toBe(true)
  })

  test("a stale frame from the previous visit does not render the next one", () => {
    const state = play(INITIAL_REVIEW_RENDER_STATE, visit(1), settled(1), visit(2), visit(3))

    expect(state.effects.slice(-2)).toEqual([{ type: "frame.cancel" }, { type: "frame.schedule", attempt: 3 }])
    expect(transitionReviewRender(state.state, settled(2)).state).toBe(state.state)
  })
})

test("disposal cancels a pending frame and ignores later events", () => {
  const deferring = play(INITIAL_REVIEW_RENDER_STATE, visit(1)).state
  const disposed = play(deferring, { type: "disposed" })

  expect(disposed.effects).toEqual([{ type: "frame.cancel" }])
  expect(reviewPanelReady(disposed.state)).toBe(false)

  for (const event of [settled(1), visit(2), { type: "disposed" }] satisfies ReviewRenderEvent[])
    expect(transitionReviewRender(disposed.state, event).state).toBe(disposed.state)

  const ready = play(INITIAL_REVIEW_RENDER_STATE, visit(1), settled(1)).state

  expect(play(ready, { type: "disposed" }).effects).toEqual([])
})
