import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("basic FIFO order", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    expect(await q.next()).toBe(1)
    expect(await q.next()).toBe(2)
    expect(await q.next()).toBe(3)
  })

  test("drops oldest entry when limit is reached", async () => {
    const q = new AsyncQueue<number>(3)
    q.push(1)
    q.push(2)
    q.push(3)
    q.push(4) // should drop 1
    expect(await q.next()).toBe(2)
    expect(await q.next()).toBe(3)
    expect(await q.next()).toBe(4)
  })

  test("queue length never exceeds limit", () => {
    const limit = 5
    const q = new AsyncQueue<number>(limit)
    for (let i = 0; i < 100; i++) q.push(i)
    // drain and count
    let count = 0
    while ((q as any).queue.length > 0) {
      ;(q as any).queue.shift()
      count++
    }
    expect(count).toBeLessThanOrEqual(limit)
  })

  test("item delivered directly to waiting resolver bypasses limit", async () => {
    const q = new AsyncQueue<number>(2)
    // consumer is already waiting
    const result = q.next()
    q.push(99)
    expect(await result).toBe(99)
    // internal queue should still be empty
    expect((q as any).queue.length).toBe(0)
  })

  test("null sentinel terminates async iteration", async () => {
    const q = new AsyncQueue<number | null>()
    q.push(1)
    q.push(2)
    q.push(null)
    const collected: number[] = []
    for await (const item of q) {
      if (item === null) break
      collected.push(item)
    }
    expect(collected).toEqual([1, 2])
  })

  test("zombie scenario: 10000 pushes with no consumer stays bounded", () => {
    const limit = 100
    const q = new AsyncQueue<number>(limit)
    for (let i = 0; i < 10_000; i++) q.push(i)
    expect((q as any).queue.length).toBe(limit)
    // most recent items are retained
    expect((q as any).queue[(q as any).queue.length - 1]).toBe(9999)
  })
})
