import { describe, expect, test } from "bun:test"
import {
  createTextShimmerState,
  DISPOSED_TEXT_SHIMMER_EVENT,
  DISPOSED_TEXT_SHIMMER_STATE,
  INITIAL_ACTIVE_TEXT_SHIMMER_STATE,
  INITIAL_INACTIVE_TEXT_SHIMMER_STATE,
  selectTextShimmerActive,
  selectTextShimmerRunning,
  syncTextShimmerEvent,
  transitionTextShimmer,
  type TextShimmerEvent,
  type TextShimmerState,
} from "./machine"

const run = (state: TextShimmerState, ...events: TextShimmerEvent[]) => events.reduce(transitionTextShimmer, state)

const view = (state: TextShimmerState) => ({
  active: selectTextShimmerActive(state),
  running: selectTextShimmerRunning(state),
})

const activate = syncTextShimmerEvent(true, false)

const deactivate = syncTextShimmerEvent(false, false)

const deactivateReduced = syncTextShimmerEvent(false, true)

describe("mount", () => {
  test("an inactive shimmer has nothing to fade, so it stays put without a settle timer", () => {
    // Before the machine, every inactive mount scheduled a 220 ms timer to turn the sweep from off to off.
    const state = createTextShimmerState(false)

    expect(state).toBe(INITIAL_INACTIVE_TEXT_SHIMMER_STATE)
    expect(view(state)).toEqual({ active: false, running: false })
    expect(transitionTextShimmer(state, deactivate)).toBe(state)
    expect(transitionTextShimmer(state, deactivateReduced)).toBe(state)
    expect(transitionTextShimmer(state, { type: "settled", attempt: 0 })).toBe(state)
  })

  test("an active shimmer shows and runs the sweep", () => {
    const state = createTextShimmerState(true)

    expect(state).toBe(INITIAL_ACTIVE_TEXT_SHIMMER_STATE)
    expect(view(state)).toEqual({ active: true, running: true })
    expect(transitionTextShimmer(state, activate)).toBe(state)
  })

  test("sync events are shared singletons", () => {
    expect(syncTextShimmerEvent(true, false)).toBe(syncTextShimmerEvent(true, false))
    expect(syncTextShimmerEvent(false, true)).toBe(syncTextShimmerEvent(false, true))
    expect(Object.isFrozen(syncTextShimmerEvent(false, false))).toBe(true)
  })
})

describe("crossfade", () => {
  test("deactivating fades out, keeps the sweep running, then settles", () => {
    const fading = transitionTextShimmer(INITIAL_ACTIVE_TEXT_SHIMMER_STATE, deactivate)

    expect(fading).toEqual({ status: "fading", attempt: 1 })
    expect(view(fading)).toEqual({ active: false, running: true })
    expect(transitionTextShimmer(fading, deactivate)).toBe(fading)

    const settled = transitionTextShimmer(fading, { type: "settled", attempt: 1 })
    expect(settled).toEqual({ status: "inactive", attempts: 1 })
    expect(view(settled)).toEqual({ active: false, running: false })
  })

  test("reduced motion has no crossfade, so the sweep stops at once", () => {
    // Before the machine, the sweep kept running for 220 ms although the crossfade took 0 ms.
    const state = transitionTextShimmer(INITIAL_ACTIVE_TEXT_SHIMMER_STATE, deactivateReduced)

    expect(state).toBe(INITIAL_INACTIVE_TEXT_SHIMMER_STATE)
    expect(view(state)).toEqual({ active: false, running: false })
  })

  test("reduced motion during a fade settles it at once", () => {
    const state = run(INITIAL_ACTIVE_TEXT_SHIMMER_STATE, deactivate, deactivateReduced)

    expect(state).toEqual({ status: "inactive", attempts: 1 })
  })

  test("reactivating cancels the fade, and only the current fade's settle applies", () => {
    const reactivated = run(INITIAL_ACTIVE_TEXT_SHIMMER_STATE, deactivate, activate)

    expect(reactivated).toEqual({ status: "active", attempts: 1 })
    expect(transitionTextShimmer(reactivated, { type: "settled", attempt: 1 })).toBe(reactivated)

    const fading = transitionTextShimmer(reactivated, deactivate)
    expect(fading).toEqual({ status: "fading", attempt: 2 })
    expect(transitionTextShimmer(fading, { type: "settled", attempt: 1 })).toBe(fading)
    expect(transitionTextShimmer(fading, { type: "settled", attempt: 2 })).toEqual({ status: "inactive", attempts: 2 })
  })

  test("activating after a settled fade keeps counting attempts", () => {
    const state = run(INITIAL_ACTIVE_TEXT_SHIMMER_STATE, deactivate, { type: "settled", attempt: 1 }, activate)

    expect(state).toEqual({ status: "active", attempts: 1 })
    expect(transitionTextShimmer(state, deactivate)).toEqual({ status: "fading", attempt: 2 })
  })
})

describe("disposal", () => {
  test.each([
    ["inactive", INITIAL_INACTIVE_TEXT_SHIMMER_STATE],
    ["active", INITIAL_ACTIVE_TEXT_SHIMMER_STATE],
    ["fading", transitionTextShimmer(INITIAL_ACTIVE_TEXT_SHIMMER_STATE, deactivate)],
  ] as const)("disposing while %s ignores every later event", (_, state) => {
    const disposed = transitionTextShimmer(state, DISPOSED_TEXT_SHIMMER_EVENT)

    expect(disposed).toBe(DISPOSED_TEXT_SHIMMER_STATE)
    expect(view(disposed)).toEqual({ active: false, running: false })
    ;[activate, deactivate, { type: "settled", attempt: 1 } as const, DISPOSED_TEXT_SHIMMER_EVENT].forEach((event) =>
      expect(transitionTextShimmer(disposed, event)).toBe(disposed),
    )
  })
})
