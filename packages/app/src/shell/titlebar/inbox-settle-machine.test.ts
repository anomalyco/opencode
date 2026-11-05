import { describe, expect, test } from "bun:test"
import {
  INBOX_SETTLE_TIMEOUT_MS,
  INITIAL_INBOX_SETTLE_STATE,
  selectInboxLoading,
  transitionInboxSettle,
  type InboxSettleEvent,
} from "./inbox-settle-machine"

const sync = (serversSettled: boolean, workingKeys: string[], hydrated = true): InboxSettleEvent => ({
  type: "sync",
  hydrated,
  serversSettled,
  workingKeys,
})

describe("inbox settle machine", () => {
  test("a rerun while request checks are in flight does not send them again", () => {
    const first = transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, sync(true, ["s\0a", "s\0b"]))

    expect(first.effects).toEqual([
      { type: "requests.sync", key: "s\0a" },
      { type: "requests.sync", key: "s\0b" },
      { type: "reveal-timer.start", timeoutMs: INBOX_SETTLE_TIMEOUT_MS },
    ])
    expect(selectInboxLoading(first.state)).toBe(true)

    // One check lands and its store update recomputes the rows, which syncs again.
    const one = transitionInboxSettle(first.state, { type: "requests.settled", key: "s\0a" })

    expect(one.effects).toEqual([])
    expect(transitionInboxSettle(one.state, sync(true, ["s\0a", "s\0b"]))).toEqual({ state: one.state, effects: [] })

    const both = transitionInboxSettle(one.state, { type: "requests.settled", key: "s\0b" })

    expect(both.state).toEqual({ status: "settled", checks: { "s\0a": "checked", "s\0b": "checked" } })
    expect(both.effects).toEqual([{ type: "reveal-timer.clear" }])
  })

  test("one stalled server reveals the inbox after the timeout, and later working rows are still checked", () => {
    const stalled = transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, sync(false, []))

    expect(stalled.effects).toEqual([{ type: "reveal-timer.start", timeoutMs: INBOX_SETTLE_TIMEOUT_MS }])
    expect(transitionInboxSettle(stalled.state, sync(false, []))).toEqual({ state: stalled.state, effects: [] })

    const revealed = transitionInboxSettle(stalled.state, { type: "reveal.timed-out" })

    expect(selectInboxLoading(revealed.state)).toBe(false)

    const later = transitionInboxSettle(revealed.state, sync(false, ["s2\0c"]))

    expect(selectInboxLoading(later.state)).toBe(false)
    expect(later.effects).toEqual([{ type: "requests.sync", key: "s2\0c" }])
    expect(transitionInboxSettle(later.state, { type: "requests.settled", key: "s2\0c" }).state).toEqual({
      status: "settled",
      checks: { "s2\0c": "checked" },
    })
  })

  test("a warm cache settles on the first sync without arming the timer", () => {
    expect(transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, sync(true, []))).toEqual({
      state: { status: "settled", checks: {} },
      effects: [],
    })
  })

  test("waits for the server index and for hydration before settling", () => {
    const unhydrated = transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, sync(true, [], false))

    expect(selectInboxLoading(unhydrated.state)).toBe(true)

    const hydrated = transitionInboxSettle(unhydrated.state, sync(true, []))

    expect(hydrated).toEqual({ state: { status: "settled", checks: {} }, effects: [{ type: "reveal-timer.clear" }] })
  })

  test("a session that stops working does not wait for its slow check", () => {
    const waiting = transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, sync(true, ["s\0a"]))
    const idle = transitionInboxSettle(waiting.state, sync(true, []))

    expect(idle.state).toEqual({ status: "settled", checks: { "s\0a": "checking" } })
    expect(idle.effects).toEqual([{ type: "reveal-timer.clear" }])
  })

  test("dispose clears the timer and ignores later events", () => {
    const waiting = transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, sync(false, ["s\0a"]))
    const disposed = transitionInboxSettle(waiting.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "reveal-timer.clear" }])

    for (const event of [
      { type: "requests.settled", key: "s\0a" },
      { type: "reveal.timed-out" },
      sync(true, ["s\0b"]),
    ] satisfies InboxSettleEvent[])
      expect(transitionInboxSettle(disposed.state, event)).toEqual({ state: disposed.state, effects: [] })
  })

  test("ignores a check result it did not start and a timer that is not armed", () => {
    const settled = transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, sync(true, []))

    expect(transitionInboxSettle(settled.state, { type: "requests.settled", key: "x" }).state).toBe(settled.state)
    expect(transitionInboxSettle(settled.state, { type: "reveal.timed-out" }).state).toBe(settled.state)
    expect(
      transitionInboxSettle(INITIAL_INBOX_SETTLE_STATE, { type: "reveal.timed-out" }).state,
    ).toBe(INITIAL_INBOX_SETTLE_STATE)
  })
})
