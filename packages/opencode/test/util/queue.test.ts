import { describe, expect, test } from "bun:test"
import { AsyncQueue, work } from "../../src/util/queue"

describe("util.queue", () => {
  test("dequeues items in FIFO order", async () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    queue.push(2)
    queue.push(3)

    expect(await queue.next()).toBe(1)
    expect(await queue.next()).toBe(2)
    expect(await queue.next()).toBe(3)
  })

  test("resolves pending next() calls when items are pushed", async () => {
    const queue = new AsyncQueue<number>()

    const p1 = queue.next()
    const p2 = queue.next()

    queue.push(1)
    queue.push(2)

    await expect(p1).resolves.toBe(1)
    await expect(p2).resolves.toBe(2)
  })

  test("supports async iteration", async () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    queue.push(2)
    queue.push(3)

    const result: number[] = []
    for await (const item of queue) {
      result.push(item)
      if (result.length === 3) break
    }

    expect(result).toEqual([1, 2, 3])
  })

  test("next() resolves when item is pushed after call", async () => {
    const queue = new AsyncQueue<number>()
    const nextPromise = queue.next()

    setTimeout(() => queue.push(42), 10)

    await expect(nextPromise).resolves.toBe(42)
  })

  test("work() processes all items with concurrency", async () => {
    const processed: number[] = []

    await work(2, [1, 2, 3, 4], async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      processed.push(item)
    })

    expect(processed.sort()).toEqual([1, 2, 3, 4])
  })
})