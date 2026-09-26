import { describe, expect, test } from "bun:test"
import { makeDesyncLatch } from "../../src/server/routes/instance/httpapi/handlers/event-desync"

describe("SSE desync latch", () => {
  test("stays quiet until the buffer is full", () => {
    const latch = makeDesyncLatch({ capacity: 4, intervalMs: 1000, now: () => 0 })
    expect(latch.shouldSignal(0)).toBe(false)
    expect(latch.shouldSignal(3)).toBe(false)
    expect(latch.shouldSignal(4)).toBe(true)
  })

  test("re-signals sustained overflow that never drains to empty", () => {
    let now = 0
    const latch = makeDesyncLatch({ capacity: 4, intervalMs: 1000, now: () => now })

    expect(latch.shouldSignal(4)).toBe(true)
    // Still full and within the cool-down: no spam.
    expect(latch.shouldSignal(4)).toBe(false)
    now = 1000
    // Still full, cool-down elapsed: the consumer is told again.
    expect(latch.shouldSignal(4)).toBe(true)
    now = 1999
    expect(latch.shouldSignal(4)).toBe(false)
    now = 2000
    expect(latch.shouldSignal(4)).toBe(true)
  })

  test("re-arms for an immediate signal after a partial drain", () => {
    let now = 0
    const latch = makeDesyncLatch({ capacity: 4, intervalMs: 1000, now: () => now })

    expect(latch.shouldSignal(4)).toBe(true)
    expect(latch.shouldSignal(3)).toBe(false)
    // A fresh overflow episode signals immediately, not after the cool-down.
    expect(latch.shouldSignal(4)).toBe(true)
    now = 10
    expect(latch.shouldSignal(4)).toBe(false)
  })
})
