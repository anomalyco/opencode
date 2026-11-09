import { expect, test } from "bun:test"
import {
  createConsoleSettleState,
  transitionConsoleSettle,
  type ConsoleSettleEffect,
  type ConsoleSettleEvent,
  type ConsoleSettleState,
} from "./settle-machine"

function replay(events: ConsoleSettleEvent[], from: ConsoleSettleState = createConsoleSettleState()) {
  return events.reduce<{ state: ConsoleSettleState; effects: ConsoleSettleEffect[] }>(
    (result, event) => {
      const next = transitionConsoleSettle(result.state, event)

      return { state: next.state, effects: [...next.effects] }
    },
    { state: from, effects: [] },
  )
}

test.each([
  { name: "closing the owner", leave: { type: "disposed" } as const, status: "disposed" },
  { name: "Back", leave: { type: "cancelled" } as const, status: "idle" },
])("$name stops polling at once and ignores late reads", (row) => {
  const syncing = replay([
    { type: "started", loaded: false },
    { type: "poll.due", attempt: 1, loaded: false },
  ])

  expect(syncing.effects).toEqual([{ type: "sync", attempt: 1 }])

  const left = replay([row.leave], syncing.state)
  expect(left.state.status).toBe(row.status)
  expect(left.effects).toEqual([{ type: "timers.stop" }, { type: "settled", attempt: 1, outcome: "cancelled" }])

  for (const late of [
    { type: "sync.settled", attempt: 1, loaded: true },
    { type: "timed-out", attempt: 1, loaded: false },
    { type: "poll.due", attempt: 1, loaded: true },
  ] as const) {
    const after = replay([late], left.state)
    expect(after.state).toBe(left.state)
    expect(after.effects).toEqual([])
  }
})

test("a failed catalog read keeps polling until the workspace loads", () => {
  const started = replay([{ type: "started", loaded: false }])
  expect(started.effects).toEqual([
    { type: "deadline.start", attempt: 1, timeoutMs: 10_000 },
    { type: "poll.schedule", attempt: 1, delayMs: 250 },
  ])

  // The driver reports a rejected read as a settled read that found nothing.
  const missed = replay(
    [
      { type: "poll.due", attempt: 1, loaded: false },
      { type: "sync.settled", attempt: 1, loaded: false },
    ],
    started.state,
  )

  expect(missed.effects).toEqual([{ type: "poll.schedule", attempt: 1, delayMs: 250 }])

  const loaded = replay(
    [
      { type: "poll.due", attempt: 1, loaded: false },
      { type: "sync.settled", attempt: 1, loaded: true },
    ],
    missed.state,
  )

  expect(loaded.state.status).toBe("idle")
  expect(loaded.effects).toEqual([{ type: "timers.stop" }, { type: "settled", attempt: 1, outcome: "loaded" }])
})

test("a workspace that already loaded settles without polling", () => {
  const result = replay([{ type: "started", loaded: true }])

  expect(result.state).toEqual({ status: "idle", attempt: 1 })
  expect(result.effects).toEqual([{ type: "settled", attempt: 1, outcome: "loaded" }])
})

test("the workspace appearing between polls settles at once", () => {
  const result = replay([{ type: "started", loaded: false }, { type: "catalog.loaded" }])

  expect(result.effects).toEqual([{ type: "timers.stop" }, { type: "settled", attempt: 1, outcome: "loaded" }])
})

test("a poll that comes due during a read waits for that read", () => {
  const syncing = replay([
    { type: "started", loaded: false },
    { type: "poll.due", attempt: 1, loaded: false },
  ])

  const due = replay([{ type: "poll.due", attempt: 1, loaded: false }], syncing.state)

  expect(due.state).toBe(syncing.state)
  expect(due.effects).toEqual([])
})

test("the deadline ends the wait, and a new wait cancels the one it replaces", () => {
  const started = replay([{ type: "started", loaded: false }])

  const timedOut = replay([{ type: "timed-out", attempt: 1, loaded: false }], started.state)
  expect(timedOut.effects).toEqual([{ type: "timers.stop" }, { type: "settled", attempt: 1, outcome: "timed-out" }])

  const replaced = replay([{ type: "started", loaded: false }], started.state)
  expect(replaced.state).toEqual({ status: "waiting", attempt: 2, syncing: false })
  expect(replaced.effects).toEqual([
    { type: "timers.stop" },
    { type: "settled", attempt: 1, outcome: "cancelled" },
    { type: "deadline.start", attempt: 2, timeoutMs: 10_000 },
    { type: "poll.schedule", attempt: 2, delayMs: 250 },
  ])
  expect(replay([{ type: "poll.due", attempt: 1, loaded: true }], replaced.state).state).toBe(replaced.state)
})

test("a wait asked for after the owner closed answers cancelled", () => {
  const result = replay([{ type: "disposed" }, { type: "started", loaded: false }])

  expect(result.effects).toEqual([{ type: "settled", attempt: 1, outcome: "cancelled" }])
})
