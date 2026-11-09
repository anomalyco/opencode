import { describe, expect, test } from "bun:test"
import {
  INITIAL_FOCUS_LOCK_STATE,
  transitionFocusLock,
  type FocusLockEffect,
  type FocusLockEvent,
  type FocusLockState,
} from "./focus-lock-machine"

const replay = (events: FocusLockEvent[], state = INITIAL_FOCUS_LOCK_STATE) =>
  events.reduce<{ state: FocusLockState; effects: FocusLockEffect[] }>(
    (current, event) => {
      const next = transitionFocusLock(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const focus = (focused: boolean): FocusLockEvent => ({ type: "focus.changed", focused })

describe("notification focus lock", () => {
  test("a blur and an immediate refocus request the lock again", () => {
    const held = replay([focus(true), { type: "lock.acquired", attempt: 1 }]).state
    expect(held).toEqual({ status: "held", attempt: 1 })

    // Both events land before the released lock callback resumes.
    const result = replay([focus(false), focus(true)], held)
    expect(result.effects).toEqual([
      { type: "lock.release", attempt: 1 },
      { type: "lock.acquire", attempt: 2 },
    ])
    expect(result.state).toEqual({ status: "requesting", attempt: 2, focused: true })
    expect(replay([{ type: "lock.acquired", attempt: 2 }], result.state).state).toEqual({ status: "held", attempt: 2 })
  })

  test("a grant after disposal is released", () => {
    const disposed = replay([focus(true), { type: "disposed" }])
    expect(disposed.state.status).toBe("disposed")
    expect(disposed.effects).toEqual([{ type: "lock.acquire", attempt: 1 }])

    const late = transitionFocusLock(disposed.state, { type: "lock.acquired", attempt: 1 })
    expect(late.state).toBe(disposed.state)
    expect(late.effects).toEqual([{ type: "lock.release", attempt: 1 }])
  })

  test("disposing while held releases the lock", () => {
    const result = replay([focus(true), { type: "lock.acquired", attempt: 1 }, { type: "disposed" }])
    expect(result.effects.at(-1)).toEqual({ type: "lock.release", attempt: 1 })
    expect(transitionFocusLock(result.state, focus(true)).effects).toEqual([])
  })

  test("focus changes while requesting do not request twice", () => {
    const flicker = replay([focus(true), focus(false), focus(true)])
    expect(flicker.effects).toEqual([{ type: "lock.acquire", attempt: 1 }])
    expect(replay([{ type: "lock.acquired", attempt: 1 }], flicker.state).state).toEqual({ status: "held", attempt: 1 })

    // Still unfocused when the grant arrives: release it at once.
    const blurred = replay([focus(true), focus(false), { type: "lock.acquired", attempt: 1 }])
    expect(blurred.state).toEqual({ status: "unfocused", attempt: 1 })
    expect(blurred.effects.at(-1)).toEqual({ type: "lock.release", attempt: 1 })
  })

  test("a failed request lets the next focus try again", () => {
    const failed = replay([focus(true), { type: "lock.failed", attempt: 1 }])
    expect(failed.state).toEqual({ status: "unfocused", attempt: 1 })
    expect(transitionFocusLock(failed.state, focus(true)).effects).toEqual([{ type: "lock.acquire", attempt: 2 }])
  })

  test("a stale grant is released and a stale failure is ignored", () => {
    const requesting = replay([focus(true), focus(false), focus(true)]).state
    const held = replay([{ type: "lock.acquired", attempt: 1 }], requesting).state
    const stale = transitionFocusLock(held, { type: "lock.acquired", attempt: 0 })
    expect(stale.state).toBe(held)
    expect(stale.effects).toEqual([{ type: "lock.release", attempt: 0 }])
    expect(transitionFocusLock(held, { type: "lock.failed", attempt: 0 }).state).toBe(held)
    expect(transitionFocusLock(held, focus(true)).state).toBe(held)
  })
})
