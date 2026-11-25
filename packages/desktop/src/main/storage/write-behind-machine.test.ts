import { describe, expect, test } from "bun:test"
import {
  initialWriteBehindState,
  isWriteBehindClosed,
  selectPendingRows,
  transitionWriteBehind,
  type WriteBehindCommand,
  type WriteBehindEvent,
  type WriteBehindState,
} from "./write-behind-machine"

const delay = 10

const error = new Error("SQLITE_BUSY")

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly WriteBehindEvent<number>[], from = initialWriteBehindState<number>()) {
  return events.reduce<{ state: WriteBehindState<number>; commands: (readonly WriteBehindCommand<number>[])[] }>(
    (result, event) => {
      const next = transitionWriteBehind(result.state, event, delay)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

const set = (key: string, value: number): WriteBehindEvent<number> => ({ type: "set", key, value })

const timer = (attempt: number): WriteBehindEvent<number> => ({ type: "timer.fired", attempt })

const failed = (attempt: number): WriteBehindEvent<number> => ({ type: "write.failed", attempt, error })

const succeeded = (attempt: number): WriteBehindEvent<number> => ({ type: "write.succeeded", attempt })

describe("write-behind machine", () => {
  test("schedules a retry for a failed write instead of leaving the rows waiting for another set", () => {
    const result = replay([set("a", 1), timer(1), failed(2)])

    expect(result.state).toEqual({ status: "scheduled", pending: new Map([["a", 1]]), attempt: 3, failures: 1 })
    expect(result.commands).toEqual([
      [{ type: "start-timer", attempt: 1, delayMs: delay }],
      [{ type: "cancel-timer" }, { type: "write", attempt: 2, batch: new Map([["a", 1]]) }],
      [
        { type: "start-timer", attempt: 3, delayMs: delay },
        { type: "report-error", error },
      ],
    ])
  })

  test("backs off up to 64 times the delay, then resets after a success", () => {
    const failures = Array.from({ length: 8 }, (_, index) => [timer(1 + index * 2), failed(2 + index * 2)]).flat()
    const result = replay([set("a", 1), ...failures, timer(17), succeeded(18), set("b", 1)])

    const delays = result.commands
      .flat()
      .flatMap((command) => (command.type === "start-timer" ? [command.delayMs / delay] : []))

    expect(delays).toEqual([1, 1, 2, 4, 8, 16, 32, 64, 64, 1])
  })

  test.each([
    ["refuses a set", set("a", 1)],
    ["ignores a flush", { type: "flush.requested" }],
  ] satisfies [string, WriteBehindEvent<number>][])("%s after close", (_name, event) => {
    const closed = replay([{ type: "close.requested" }]).state
    const result = transitionWriteBehind(closed, event, delay)

    expect(isWriteBehindClosed(closed)).toBe(true)
    expect(result.state).toBe(closed)
    expect(result.commands).toEqual(event.type === "set" ? [{ type: "reject-closed" }] : [])
  })

  test("writes queued rows on close and refuses rows set while that write runs", () => {
    const closing = replay([set("a", 1), { type: "close.requested" }])
    const late = transitionWriteBehind(closing.state, set("b", 2), delay)

    expect(closing.commands.at(-1)).toEqual([
      { type: "cancel-timer" },
      { type: "write", attempt: 2, batch: new Map([["a", 1]]) },
    ])
    expect(isWriteBehindClosed(closing.state)).toBe(true)
    expect(late).toEqual({ state: closing.state, commands: [{ type: "reject-closed" }] })
  })

  test("closes without a retry when the last write fails", () => {
    const result = replay([set("a", 1), { type: "close.requested" }, failed(2)])

    expect(result.state.status).toBe("closed")
    expect(result.commands.at(-1)).toEqual([{ type: "report-error", error }])
  })

  test("ignores a timer or write result from another attempt", () => {
    const scheduled = replay([set("a", 1)]).state
    const flushing = replay([{ type: "flush.requested" }], scheduled).state

    expect(transitionWriteBehind(scheduled, timer(0), delay).state).toBe(scheduled)
    expect(transitionWriteBehind(flushing, succeeded(1), delay).state).toBe(flushing)
    expect(transitionWriteBehind(flushing, failed(3), delay).state).toBe(flushing)
    expect(transitionWriteBehind(flushing, timer(1), delay).state).toBe(flushing)
  })

  test("a row set during a write wins over the failed one and is written next", () => {
    const result = replay([set("a", 1), set("b", 1), timer(1), set("a", 2), failed(2)])

    expect([...selectPendingRows(result.state)]).toEqual([
      ["a", 2],
      ["b", 1],
    ])
  })

  test("queues rows set during a successful write for the next flush", () => {
    const result = replay([set("a", 1), timer(1), set("b", 2), succeeded(2)])

    expect(result.state).toEqual({ status: "scheduled", pending: new Map([["b", 2]]), attempt: 3, failures: 0 })
    expect(result.commands.at(-1)).toEqual([{ type: "start-timer", attempt: 3, delayMs: delay }])
  })

  test("stops the timer when a drop clears every queued row", () => {
    const partial = replay([set("a", 1), set("b", 2), { type: "drop", predicate: (value) => value === 1 }])
    const all = replay([{ type: "drop", predicate: () => true }], partial.state)

    expect([...selectPendingRows(partial.state)]).toEqual([["b", 2]])
    expect(partial.commands.at(-1)).toEqual([])
    expect(all.state.status).toBe("idle")
    expect(all.commands).toEqual([[{ type: "cancel-timer" }]])
  })

  test("a row dropped during a write is not written again when it fails", () => {
    const result = replay([set("a", 1), timer(1), { type: "drop", predicate: () => true }, failed(2)])

    expect(result.state.status).toBe("idle")
    expect(result.commands.at(-1)).toEqual([{ type: "report-error", error }])
  })
})
