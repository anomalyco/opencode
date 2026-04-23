import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("util.queue", () => {
  test("buffers items when nothing is consuming", () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    expect(q.size).toBe(3)
  })

  test("delivers pushed items to a waiting consumer", async () => {
    const q = new AsyncQueue<number>()
    const waiter = q.next()
    q.push(42)
    expect(await waiter).toBe(42)
    expect(q.size).toBe(0)
  })

  test("preserves FIFO order", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    expect(await q.next()).toBe(1)
    expect(await q.next()).toBe(2)
    expect(await q.next()).toBe(3)
  })

  test("iterates pushed items as an async iterable until closed", async () => {
    const q = new AsyncQueue<number | null>()
    q.push(1)
    q.push(2)
    q.push(3)

    const seen: number[] = []
    const consumer = (async () => {
      for await (const item of q) {
        if (item === null) break
        seen.push(item)
      }
    })()
    // Wait until the buffered items have been drained, then close to unblock
    // the iterator that is now awaiting the next item.
    while (q.size > 0) await Promise.resolve()
    q.close(null)
    await consumer
    expect(seen).toEqual([1, 2, 3])
  })

  test("close() drops buffered items and unblocks waiters", async () => {
    const q = new AsyncQueue<string | null>()
    q.push("a")
    q.push("b")
    expect(q.size).toBe(2)

    // Attach a waiter that is already past the buffer.
    q.push("c")
    const consumed: (string | null)[] = []
    consumed.push(await q.next()) // "a"
    consumed.push(await q.next()) // "b"
    consumed.push(await q.next()) // "c"

    // Now nothing buffered, a waiter is pending.
    const pending = q.next()
    q.close(null)
    expect(await pending).toBeNull()
    expect(q.size).toBe(0)
  })

  test("close() ignores subsequent pushes", async () => {
    const q = new AsyncQueue<number | null>()
    q.close(null)
    q.push(1)
    q.push(2)
    expect(q.size).toBe(0)
    expect(await q.next()).toBeNull()
  })

  test("close() is idempotent", async () => {
    const q = new AsyncQueue<number | null>()
    q.push(1)
    q.close(null)
    q.close(null)
    // Still returns the close sentinel because buffer was dropped on first close.
    expect(await q.next()).toBeNull()
  })

  test("close() drops buffer so iterator exits immediately", async () => {
    const q = new AsyncQueue<string | null>()
    // Simulate a stuck consumer: fill the queue with many items before close.
    for (let i = 0; i < 100; i++) q.push("item-" + i)
    q.close(null)
    // Despite 100 buffered items, iteration should terminate immediately.
    const seen: string[] = []
    for await (const item of q) {
      if (item === null) break
      seen.push(item)
    }
    expect(seen).toEqual([])
  })
})
