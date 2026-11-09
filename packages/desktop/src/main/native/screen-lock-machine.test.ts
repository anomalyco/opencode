import { describe, expect, test } from "bun:test"
import {
  initialScreenLockState,
  isScreenLocked,
  transitionScreenLock,
  type ScreenLockEvent,
} from "./screen-lock-machine"

// Folds events through the machine and records whether the screen counts as locked after each.
function replay(events: readonly ScreenLockEvent[]) {
  return events.reduce<{ state: typeof initialScreenLockState; locked: boolean[] }>(
    (result, event) => {
      const state = transitionScreenLock(result.state, event)

      return { state, locked: [...result.locked, isScreenLocked(state)] }
    },
    { state: initialScreenLockState, locked: [] },
  ).locked
}

describe("screen lock machine", () => {
  test("follows the lock screen events", () => {
    expect(
      replay([
        { type: "screen", locked: true },
        { type: "screen", locked: false },
      ]),
    ).toEqual([true, false])
  })

  test("reads the idle state where no lock events exist", () => {
    expect(
      replay([
        { type: "probed", idle: "active" },
        { type: "probed", idle: "locked" },
        { type: "probed", idle: "unknown" },
        { type: "probed", idle: "idle" },
      ]),
    ).toEqual([false, true, true, false])
  })

  test("locks on sleep and decides on wake from the idle state", () => {
    expect(replay([{ type: "suspended" }, { type: "resumed", idle: "locked" }])).toEqual([true, true])
    expect(replay([{ type: "suspended" }, { type: "resumed", idle: "unknown" }])).toEqual([true, false])
  })

  test("stays locked while another login session is active, whatever the idle state says", () => {
    expect(
      replay([
        { type: "session", active: false },
        { type: "probed", idle: "active" },
        { type: "screen", locked: false },
        { type: "session", active: true },
      ]),
    ).toEqual([true, true, true, false])
  })

  test("keeps the state object when nothing changes", () => {
    const state = transitionScreenLock(initialScreenLockState, { type: "screen", locked: false })

    expect(state).toBe(initialScreenLockState)
  })
})
