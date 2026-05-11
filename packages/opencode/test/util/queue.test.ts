import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("drain returns queued items and empties queue", () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    queue.push(2)
    expect(queue.drain()).toEqual([1, 2])
    expect(queue.drain()).toEqual([])
  })

  test("close resolves pending consumers and marks closed", async () => {
    const queue = new AsyncQueue<number>()
    const pending = queue.next()
    queue.close()

    expect(queue.isClosed).toBe(true)
    expect(await pending).toBeUndefined()
  })

  test("async iterator stops when closed and rejects later pushes", async () => {
    const queue = new AsyncQueue<number>()
    const iterator = queue[Symbol.asyncIterator]()
    queue.push(1)

    expect(await iterator.next()).toEqual({ value: 1, done: false })
    queue.close()
    queue.push(2)
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })
})
