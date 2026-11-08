import { describe, expect, test } from "bun:test"
import {
  INITIAL_REVIEW_SCREEN_STATE,
  reviewScreenDemand,
  reviewScreenModel,
  reviewScreenModels,
  transitionReviewScreen,
  type ReviewScreenEffect,
  type ReviewScreenEvent,
  type ReviewScreenState,
} from "./screen-machine"

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: ReviewScreenState, ...events: ReviewScreenEvent[]) {
  return events.reduce<{ state: ReviewScreenState; effects: readonly ReviewScreenEffect[] }>(
    (result, event) => {
      const next = transitionReviewScreen(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// Screen 1 routes a session and renders the review panel (panel 10), as a session with the side region open does.
function shown() {
  return play(
    INITIAL_REVIEW_SCREEN_STATE,
    { type: "route.entered", screenID: 1 },
    { type: "panel.mounted", screenID: 1, panelID: 10 },
  )
}

describe("a server switch", () => {
  test("gives the new screen's panel its own model before the route publishes the screen", () => {
    const mounted = play(shown().state, { type: "panel.mounted", screenID: 2, panelID: 20 })

    expect(mounted.effects).toEqual([{ type: "model.create", screenID: 2, attempt: 2 }])
    expect(reviewScreenModel(mounted.state, 2)).toBe(2)
    expect(reviewScreenModel(mounted.state, 1)).toBe(1)
    expect(reviewScreenModels(mounted.state)).toEqual([1, 2])
  })

  test("disposes only the old screen's model, whichever of route and unmount comes first", () => {
    const mounted = play(shown().state, { type: "panel.mounted", screenID: 2, panelID: 20 }).state

    const routedFirst = play(
      mounted,
      { type: "route.entered", screenID: 2 },
      { type: "panel.unmounted", screenID: 1, panelID: 10 },
    )

    const unmountedFirst = play(
      mounted,
      { type: "panel.unmounted", screenID: 1, panelID: 10 },
      { type: "route.entered", screenID: 2 },
    )

    expect(routedFirst.effects).toEqual([{ type: "model.dispose", screenID: 1, attempt: 1 }])
    expect(unmountedFirst.effects).toEqual([{ type: "model.dispose", screenID: 1, attempt: 1 }])
    expect(reviewScreenModels(routedFirst.state)).toEqual([2])
    expect(routedFirst.state).toEqual(unmountedFirst.state)
  })
})

describe("a moment without a route", () => {
  test("keeps the model while its panel renders, however long the moment lasts", () => {
    const left = play(shown().state, { type: "route.left" })

    expect(left.effects).toEqual([])
    expect(reviewScreenModel(left.state, 1)).toBe(1)

    const back = play(left.state, { type: "route.entered", screenID: 1 })

    expect(back.effects).toEqual([])
    expect(reviewScreenModel(back.state, 1)).toBe(1)
  })

  test("disposes the model once nothing holds the screen", () => {
    const left = play(
      INITIAL_REVIEW_SCREEN_STATE,
      { type: "route.entered", screenID: 1 },
      { type: "route.left" },
      { type: "route.left" },
    )

    expect(left.effects).toEqual([
      { type: "model.create", screenID: 1, attempt: 1 },
      { type: "model.dispose", screenID: 1, attempt: 1 },
    ])
    expect(reviewScreenModel(left.state, 1)).toBeUndefined()
  })
})

describe("watches", () => {
  test("a released watch releases only its own hold, once", () => {
    const watched = play(
      shown().state,
      { type: "watch.added", screenID: 1, watchID: 30, source: "files" },
      { type: "watch.added", screenID: 1, watchID: 31, source: "files" },
    ).state

    expect(reviewScreenDemand(watched, 1).files).toBe(2)

    const released = transitionReviewScreen(watched, { type: "watch.removed", screenID: 1, watchID: 30 }).state

    expect(reviewScreenDemand(released, 1).files).toBe(1)
    expect(transitionReviewScreen(released, { type: "watch.removed", screenID: 1, watchID: 30 }).state).toBe(released)
  })

  test("hold their demand before the screen routes, and keep a model nothing else holds", () => {
    const watching = play(INITIAL_REVIEW_SCREEN_STATE, {
      type: "watch.added",
      screenID: 1,
      watchID: 30,
      source: "details",
    })

    expect(watching.effects).toEqual([])
    expect(reviewScreenModel(watching.state, 1)).toBeUndefined()
    expect(reviewScreenDemand(watching.state, 1)).toEqual({ tree: 0, files: 0, panel: 0, details: 1 })

    const routed = play(watching.state, { type: "route.entered", screenID: 1 }, { type: "route.left" })

    expect(routed.effects).toEqual([{ type: "model.create", screenID: 1, attempt: 1 }])
    expect(reviewScreenDemand(routed.state, 1).details).toBe(1)

    const released = play(routed.state, { type: "watch.removed", screenID: 1, watchID: 30 })

    expect(released.effects).toEqual([{ type: "model.dispose", screenID: 1, attempt: 1 }])
  })

  test("a watch released before the screen routes leaves nothing behind", () => {
    const state = play(
      INITIAL_REVIEW_SCREEN_STATE,
      { type: "watch.added", screenID: 1, watchID: 30, source: "files" },
      { type: "watch.removed", screenID: 1, watchID: 30 },
    )

    expect(state.effects).toEqual([])
    expect(state.state).toEqual(INITIAL_REVIEW_SCREEN_STATE)
  })
})

test("disposal disposes every model and ignores later events", () => {
  const disposed = play(
    shown().state,
    { type: "panel.mounted", screenID: 2, panelID: 20 },
    { type: "watch.added", screenID: 3, watchID: 30, source: "files" },
    { type: "disposed" },
  )

  expect(disposed.effects.filter((effect) => effect.type === "model.dispose")).toEqual([
    { type: "model.dispose", screenID: 1, attempt: 1 },
    { type: "model.dispose", screenID: 2, attempt: 2 },
  ])

  const late = play(
    disposed.state,
    { type: "route.entered", screenID: 1 },
    { type: "panel.unmounted", screenID: 1, panelID: 10 },
  )

  expect(late.state).toBe(disposed.state)
  expect(late.effects).toEqual([])
})
