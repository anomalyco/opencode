import { describe, expect, test } from "bun:test"
import {
  INITIAL_CHECKOUT_LABEL_STATE,
  selectCheckoutSkeleton,
  transitionCheckoutLabel,
  type CheckoutLabelEffect,
  type CheckoutLabelEvent,
  type CheckoutLabelState,
} from "./checkout-machine"

function replay(events: CheckoutLabelEvent[], state = INITIAL_CHECKOUT_LABEL_STATE) {
  return events.reduce<{ state: CheckoutLabelState; effects: readonly CheckoutLabelEffect[] }>(
    (step, event) => transitionCheckoutLabel(step.state, event),
    { state, effects: [] },
  )
}

const changed = (directory: string, loaded: boolean): CheckoutLabelEvent => ({
  type: "checkout.changed",
  directory,
  loaded,
})

const elapsed = (attempt: number): CheckoutLabelEvent => ({ type: "delay.elapsed", attempt })

describe("checkout label machine", () => {
  test("a checkout that loads before the delay never shows the placeholder", () => {
    const waiting = replay([changed("/repo", false)])

    expect(waiting.effects).toEqual([{ type: "delay.start", attempt: 1 }])

    const loaded = replay([changed("/repo", true)], waiting.state)

    expect(loaded.effects).toEqual([{ type: "delay.stop", attempt: 1 }])
    expect(selectCheckoutSkeleton(replay([elapsed(1)], loaded.state).state)).toBe(false)
  })

  test("a slow checkout shows the placeholder until it loads", () => {
    const skeleton = replay([changed("/repo", false), elapsed(1)])

    expect(selectCheckoutSkeleton(skeleton.state)).toBe(true)

    const loaded = replay([changed("/repo", true)], skeleton.state)

    expect(selectCheckoutSkeleton(loaded.state)).toBe(false)
    expect(loaded.effects).toEqual([])
  })

  test("another checkout restarts the delay and ignores the previous one's timer", () => {
    const switched = replay([changed("/repo", false), changed("/other", false)])

    expect(switched.effects).toEqual([
      { type: "delay.stop", attempt: 1 },
      { type: "delay.start", attempt: 2 },
    ])
    expect(replay([elapsed(1)], switched.state).state).toBe(switched.state)
    expect(selectCheckoutSkeleton(replay([elapsed(2)], switched.state).state)).toBe(true)
  })

  test("the same pending checkout keeps its delay", () => {
    const waiting = replay([changed("/repo", false)])

    expect(transitionCheckoutLabel(waiting.state, changed("/repo", false)).state).toBe(waiting.state)
  })

  test("disposing stops a pending delay and ignores later events", () => {
    const disposed = replay([changed("/repo", false), { type: "disposed" }])

    expect(disposed.effects).toEqual([{ type: "delay.stop", attempt: 1 }])
    expect(transitionCheckoutLabel(disposed.state, elapsed(1)).state).toBe(disposed.state)
    expect(transitionCheckoutLabel(disposed.state, changed("/repo", false)).state).toBe(disposed.state)
  })
})
