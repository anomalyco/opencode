import { describe, expect, test } from "bun:test"
import {
  initialFocusToggleState,
  isFocusToggleActive,
  transitionFocusToggle,
  type FocusToggleEffect,
  type FocusToggleEvent,
  type FocusToggleState,
} from "./focus-machine"

// Folds events through the machine and keeps the effects of each step.
function replay(events: readonly FocusToggleEvent[], from = initialFocusToggleState) {
  return events.reduce<{ state: FocusToggleState; effects: (readonly FocusToggleEffect[])[] }>(
    (result, event) => {
      const next = transitionFocusToggle(result.state, event)

      return { state: next.state, effects: [...result.effects, next.effects] }
    },
    { state: from, effects: [] },
  )
}

const toggle: FocusToggleEvent = { type: "toggle" }

describe("debug bar force focus toggle", () => {
  test("closing the bar while turning on still turns force focus off", () => {
    // On dev the cleanup read `focus() === false` and skipped the reset, and main forced focus once the call landed.
    const closed = replay([toggle, { type: "disposed" }])

    expect(closed.state).toEqual({ status: "disposed" })
    expect(closed.effects).toEqual([[{ type: "set", attempt: 1, enabled: true }], [{ type: "reset" }]])
    expect(transitionFocusToggle(closed.state, { type: "set.succeeded", attempt: 1 }).state).toBe(closed.state)
  })

  test("a second click while turning on turns force focus back off", () => {
    // On dev both clicks read `!focus()` before the first call resolved, so both sent `true`.
    const twice = replay([toggle, toggle])

    expect(twice.effects).toEqual([[{ type: "set", attempt: 1, enabled: true }], []])
    expect(isFocusToggleActive(twice.state)).toBe(false)

    const settled = replay(
      [
        { type: "set.succeeded", attempt: 1 },
        { type: "set.succeeded", attempt: 2 },
      ],
      twice.state,
    )

    expect(settled.effects).toEqual([[{ type: "set", attempt: 2, enabled: false }], []])
    expect(settled.state).toEqual({ status: "idle", attempt: 2, enabled: false })
  })

  test("a third click before the call settles keeps force focus on without another call", () => {
    const thrice = replay([toggle, toggle, toggle, { type: "set.succeeded", attempt: 1 }])

    expect(thrice.effects.flat()).toEqual([{ type: "set", attempt: 1, enabled: true }])
    expect(thrice.state).toEqual({ status: "idle", attempt: 1, enabled: true })
  })

  test("a failed call reverts the cell and reports it", () => {
    // On dev the rejection was unhandled and the cell kept its value with no feedback.
    const failed = replay([toggle, { type: "set.failed", attempt: 1 }])

    expect(failed.state).toEqual({ status: "idle", attempt: 1, enabled: false })
    expect(failed.effects.at(-1)).toEqual([{ type: "notify-failed" }])
    expect(isFocusToggleActive(failed.state)).toBe(false)

    const retried = replay([toggle], failed.state)

    expect(retried.effects).toEqual([[{ type: "set", attempt: 2, enabled: true }]])
  })

  test("a failed call the user already clicked back from settles quietly", () => {
    const failed = replay([toggle, toggle, { type: "set.failed", attempt: 1 }])

    expect(failed.state).toEqual({ status: "idle", attempt: 1, enabled: false })
    expect(failed.effects.at(-1)).toEqual([])
  })

  test("ignores results of other attempts", () => {
    const changing = replay([toggle]).state

    expect(transitionFocusToggle(changing, { type: "set.succeeded", attempt: 2 }).state).toBe(changing)
    expect(transitionFocusToggle(changing, { type: "set.failed", attempt: 0 }).state).toBe(changing)
    expect(transitionFocusToggle(initialFocusToggleState, { type: "set.succeeded", attempt: 0 }).state).toBe(
      initialFocusToggleState,
    )
  })

  test("closing the bar resets force focus only when it may be on", () => {
    const on = replay([toggle, { type: "set.succeeded", attempt: 1 }]).state
    const turningOff = replay([toggle], on).state

    expect(transitionFocusToggle(initialFocusToggleState, { type: "disposed" }).effects).toEqual([])
    expect(transitionFocusToggle(on, { type: "disposed" }).effects).toEqual([{ type: "reset" }])
    // The call in flight already turns it off.
    expect(transitionFocusToggle(turningOff, { type: "disposed" }).effects).toEqual([])

    const disposed = transitionFocusToggle(on, { type: "disposed" }).state

    expect(transitionFocusToggle(disposed, toggle).state).toBe(disposed)
    expect(isFocusToggleActive(disposed)).toBe(false)
  })
})
