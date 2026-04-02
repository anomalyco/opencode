import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("AsyncQueue", () => {
  // --- bounded mode ---

  describe("bounded mode (capacity)", () => {
    test("drops oldest item when full", async () => {
      const q = new AsyncQueue<number>({ capacity: 3 })
      q.push(1)
      q.push(2)
      q.push(3)
      // at capacity — next push evicts oldest
      q.push(4)
      expect(await q.next()).toBe(2)
      expect(await q.next()).toBe(3)
      expect(await q.next()).toBe(4)
    })

    test("resolves pending waiters directly, bypassing capacity", async () => {
      const q = new AsyncQueue<number>({ capacity: 2 })
      // queue is empty, next() creates a waiter
      const p = q.next()
      q.push(1) // resolves waiter with 1, queue stays empty
      expect(await p).toBe(1)
      // push more to fill beyond capacity
      q.push(2)
      q.push(3)
      // only 2 and 3 in queue (capacity 2), nothing evicted because 1 went to waiter
      expect(await q.next()).toBe(2)
      expect(await q.next()).toBe(3)
    })

    test("no capacity constraint when capacity is undefined", async () => {
      const q = new AsyncQueue<number>()
      for (let i = 0; i < 1000; i++) q.push(i)
      for (let i = 0; i < 1000; i++) expect(await q.next()).toBe(i)
    })
  })

  // --- close({ clear: true }) ---

  describe("close({ clear: true }) clears backlog and finishes with sentinel", () => {
    test("emits sentinel after clearing queued items", async () => {
      const q = new AsyncQueue<string | null>({ capacity: 10, sentinel: null })
      q.push("a")
      q.push("b")
      q.close({ clear: true })
      // backlog cleared, next item should be the sentinel
      expect(await q.next()).toBe(null)
      // stays closed
      expect(await q.next()).toBe(null)
    })

    test("resolves pending waiters with sentinel", async () => {
      const q = new AsyncQueue<string | null>({ capacity: 10, sentinel: null })
      const p1 = q.next()
      const p2 = q.next()
      q.close({ clear: true })
      expect(await p1).toBe(null)
      expect(await p2).toBe(null)
    })

    test("ignores push after close", async () => {
      const q = new AsyncQueue<number>({ capacity: 10, sentinel: -1 })
      q.push(1)
      q.close({ clear: true })
      q.push(999) // ignored
      expect(await q.next()).toBe(-1) // sentinel
    })
  })

  // --- close() preserves queued items ---

  describe("close() preserves queued items before sentinel", () => {
    test("drains remaining items then yields sentinel", async () => {
      const q = new AsyncQueue<string | null>({ capacity: 10, sentinel: null })
      q.push("x")
      q.push("y")
      q.close() // no clear
      expect(await q.next()).toBe("x")
      expect(await q.next()).toBe("y")
      expect(await q.next()).toBe(null)
    })

    test("resolves pending waiters with queued items, then sentinel", async () => {
      const q = new AsyncQueue<string | null>({ capacity: 10, sentinel: null })
      q.push("first")
      const p = q.next() // resolves with "first"
      const sentinelP = q.next() // no items left, will wait → resolved by sentinel on close
      q.close()
      expect(await p).toBe("first")
      expect(await sentinelP).toBe(null)
    })

    test("InstanceDisposed pattern: push final event then close preserves both", async () => {
      // This mirrors the real route pattern:
      //   q.push(data)   // InstanceDisposed event
      //   q.close()      // no clear → sentinel queued after
      const q = new AsyncQueue<string | null>({ capacity: 512, sentinel: null })
      q.push("event-a")
      q.push("event-b")

      // simulate Bus.InstanceDisposed
      q.push('{"type":"Bus.InstanceDisposed","properties":{}}')
      q.close()

      expect(await q.next()).toBe("event-a")
      expect(await q.next()).toBe("event-b")
      expect(await q.next()).toBe('{"type":"Bus.InstanceDisposed","properties":{}}')
      expect(await q.next()).toBe(null) // sentinel
    })
  })

  // --- clear() ---

  describe("clear()", () => {
    test("removes all queued items", async () => {
      const q = new AsyncQueue<number>({ capacity: 10, sentinel: -1 })
      q.push(1)
      q.push(2)
      q.clear()
      q.close()
      expect(await q.next()).toBe(-1)
    })
  })

  // --- idempotent close ---

  describe("close idempotency", () => {
    test("second close is a no-op", async () => {
      const q = new AsyncQueue<string | null>({ sentinel: null })
      q.push("a")
      q.close({ clear: true })
      q.close({ clear: false }) // no-op
      expect(await q.next()).toBe(null)
    })
  })

  // --- async iteration ---

  describe("async iteration", () => {
    test("yields items then sentinel and stops", async () => {
      const q = new AsyncQueue<number>({ sentinel: -1 })
      q.push(10)
      q.push(20)
      q.close()
      const items: number[] = []
      for await (const item of q) {
        items.push(item)
        if (item === -1) break
      }
      expect(items).toEqual([10, 20, -1])
    })
  })
})
