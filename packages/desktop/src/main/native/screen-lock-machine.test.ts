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

  test("idle probes never clear an explicit lock or sleep", () => {
    expect(
      replay([
        { type: "screen", locked: true },
        { type: "probed", idle: "active" },
        { type: "probed", idle: "idle" },
      ]),
    ).toEqual([true, true, true])

    expect(
      replay([{ type: "suspended" }, { type: "probed", idle: "active" }, { type: "resumed", idle: "active" }]),
    ).toEqual([true, true, false])
  })

  test("a resume whose idle state is unknown keeps a probed lock", () => {
    expect(replay([{ type: "probed", idle: "locked" }, { type: "suspended" }, { type: "resumed", idle: "unknown" }])).toEqual([
      true,
      true,
      true,
    ])
  })

  test("a Linux bus unlock cannot clear an idle-probed or explicit lock", () => {
    expect(replay([{ type: "probed", idle: "locked" }, { type: "bus", locked: false }])).toEqual([true, true])
    expect(replay([{ type: "screen", locked: true }, { type: "bus", locked: false }])).toEqual([true, true])
  })

  test("a Linux bus lock is cleared when its watcher stops", () => {
    expect(
      replay([
        { type: "probed", idle: "active" },
        { type: "bus", locked: true },
        { type: "bus", locked: undefined },
      ]),
    ).toEqual([false, true, false])
  })

  test("a Linux bus lock stays until the bus reports unlocked", () => {
    expect(
      replay([
        { type: "bus", locked: true },
        { type: "screen", locked: false },
        { type: "probed", idle: "active" },
      ]),
    ).toEqual([true, true, true])
  })

  test("an explicit unlock clears a stale probe", () => {
    expect(
      replay([
        { type: "probed", idle: "locked" },
        { type: "screen", locked: false },
        { type: "probed", idle: "active" },
      ]),
    ).toEqual([true, false, false])
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
