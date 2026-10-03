import { describe, expect, test } from "bun:test"
import { createDeltaBuffer, type PendingDelta } from "./delta-buffer"

function makeBuffer(history: PendingDelta[] = []) {
  const calls: string[] = []
  const queue: Array<() => void> = []
  const buffer = createDeltaBuffer(
    (flush) => {
      calls.push("schedule")
      queue.push(flush)
    },
    (item) => history.push(item),
  )
  const tick = () => queue.shift()?.()
  return { buffer, queue, calls, tick }
}

const base = { sessionID: "s", messageID: "m" } as const

describe("createDeltaBuffer", () => {
  test("coalesces consecutive deltas for the same part into one application", () => {
    const applied: PendingDelta[] = []
    const { buffer, tick } = makeBuffer(applied)

    buffer.push({ kind: "reasoning", ...base, partID: "r1", delta: "a" })
    buffer.push({ kind: "reasoning", ...base, partID: "r1", delta: "b" })
    buffer.push({ kind: "reasoning", ...base, partID: "r1", delta: "c" })

    expect(applied).toEqual([])
    tick()
    expect(applied).toEqual([{ kind: "reasoning", ...base, partID: "r1", delta: "abc" }])
    for (const item of applied) expect(item).not.toBe(undefined)
  })

  test("keeps distinct parts and kinds separate within one flush", () => {
    const applied: PendingDelta[] = []
    const { buffer, tick } = makeBuffer(applied)

    buffer.push({ kind: "reasoning", ...base, partID: "r1", delta: "a" })
    buffer.push({ kind: "text", ...base, partID: "t1", delta: "x" })
    buffer.push({ kind: "reasoning", ...base, partID: "r1", delta: "b" })
    buffer.push({ kind: "tool", ...base, partID: "t1", delta: "y" })

    tick()
    expect(applied).toEqual([
      { kind: "reasoning", ...base, partID: "r1", delta: "ab" },
      { kind: "text", ...base, partID: "t1", delta: "x" },
      { kind: "tool", ...base, partID: "t1", delta: "y" },
    ])
  })

  test("drains pending deltas immediately without waiting for the schedule", () => {
    const applied: PendingDelta[] = []
    const { buffer, tick } = makeBuffer(applied)

    buffer.push({ kind: "reasoning", ...base, partID: "r1", delta: "a" })
    buffer.drain()
    expect(applied).toEqual([{ kind: "reasoning", ...base, partID: "r1", delta: "a" }])

    tick()
    expect(applied).toEqual([{ kind: "reasoning", ...base, partID: "r1", delta: "a" }])
  })

  test("a stale scheduled flush after drain is a no-op", () => {
    const applied: PendingDelta[] = []
    const { buffer, tick } = makeBuffer(applied)

    buffer.push({ kind: "text", ...base, partID: "t1", delta: "a" })
    buffer.drain()
    buffer.push({ kind: "text", ...base, partID: "t1", delta: "b" })

    tick()
    expect(applied).toEqual([
      { kind: "text", ...base, partID: "t1", delta: "a" },
      { kind: "text", ...base, partID: "t1", delta: "b" },
    ])
  })

  test("schedules at most one flush while deltas keep arriving", () => {
    const { buffer, calls } = makeBuffer()

    for (let i = 0; i < 100; i++) {
      buffer.push({ kind: "text", ...base, partID: "t1", delta: String(i) })
    }
    expect(calls.length).toBe(1)
  })

  test("drop removes matching pending deltas without applying them", () => {
    const applied: PendingDelta[] = []
    const { buffer, tick } = makeBuffer(applied)

    buffer.push({ kind: "text", ...base, partID: "t1", delta: "a" })
    buffer.push({ kind: "text", ...base, partID: "t2", delta: "b" })
    buffer.drop((item) => item.partID === "t1")

    tick()
    expect(applied).toEqual([{ kind: "text", ...base, partID: "t2", delta: "b" }])
  })

  test("drop for an entire message clears all of its parts", () => {
    const applied: PendingDelta[] = []
    const { buffer, tick } = makeBuffer(applied)

    buffer.push({ kind: "text", ...base, partID: "t1", delta: "a" })
    buffer.push({ kind: "reasoning", ...base, partID: "r1", delta: "x" })
    buffer.drop((item) => item.messageID === "m")

    tick()
    expect(applied).toEqual([])
  })
})
