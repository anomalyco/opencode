import { describe, expect, test } from "bun:test"
import {
  canEvict,
  INITIAL_LOCAL_STORAGE_STATE,
  isStorageNoticePending,
  transitionLocalStorage,
  type LocalStorageEvent,
} from "./storage-machine"

const replay = (events: LocalStorageEvent[]) => events.reduce(transitionLocalStorage, INITIAL_LOCAL_STORAGE_STATE)

describe("localStorage machine", () => {
  test("a failed eviction waits out a cooldown instead of disabling storage", () => {
    const state = replay([{ type: "eviction.failed", now: 1_000 }])
    expect(state.eviction).toEqual({ status: "cooldown", failures: 1, retryAt: 6_000 })
    expect(canEvict(state, 5_999)).toBe(false)
    expect(canEvict(state, 6_000)).toBe(true)
  })

  test("the cooldown doubles with each failed eviction up to a minute, and a success resets it", () => {
    const retries = [1, 2, 3, 4, 5, 6].map((count) =>
      replay(Array.from({ length: count }, () => ({ type: "eviction.failed", now: 0 }) as const)),
    )

    expect(retries.map((state) => (state.eviction.status === "cooldown" ? state.eviction.retryAt : 0))).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ])

    const recovered = transitionLocalStorage(retries[5]!, { type: "eviction.succeeded" })
    expect(recovered.eviction).toEqual({ status: "ready" })
    expect(canEvict(recovered, 0)).toBe(true)
    expect(transitionLocalStorage(recovered, { type: "eviction.failed", now: 0 }).eviction).toEqual({
      status: "cooldown",
      failures: 1,
      retryAt: 5_000,
    })
  })

  test("the first failed write asks for the notice once per page", () => {
    const failed = replay([{ type: "write.failed" }])
    expect(isStorageNoticePending(failed)).toBe(true)
    expect(failed.eviction).toBe(INITIAL_LOCAL_STORAGE_STATE.eviction)

    const shown = transitionLocalStorage(failed, { type: "notice.shown" })
    expect(isStorageNoticePending(shown)).toBe(false)
    expect(transitionLocalStorage(shown, { type: "write.failed" })).toBe(shown)
    expect(isStorageNoticePending(transitionLocalStorage(shown, { type: "eviction.failed", now: 0 }))).toBe(false)
  })

  test("events that change nothing return the same state", () => {
    expect(transitionLocalStorage(INITIAL_LOCAL_STORAGE_STATE, { type: "eviction.succeeded" })).toBe(
      INITIAL_LOCAL_STORAGE_STATE,
    )
    expect(transitionLocalStorage(INITIAL_LOCAL_STORAGE_STATE, { type: "notice.shown" })).toBe(
      INITIAL_LOCAL_STORAGE_STATE,
    )

    const pending = replay([{ type: "write.failed" }])
    expect(transitionLocalStorage(pending, { type: "write.failed" })).toBe(pending)
  })
})
