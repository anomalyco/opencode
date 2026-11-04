import { describe, expect, test } from "bun:test"
import { createLinkQueue } from "./link-queue"

describe("createLinkQueue", () => {
  test("holds links for a page until it asks, then sends live", () => {
    const queue = createLinkQueue<number>()
    expect(queue.push(1, "a")).toBe(false)
    expect(queue.push(1, "b")).toBe(false)
    expect(queue.take(1)).toEqual(["a", "b"])
    expect(queue.push(1, "c")).toBe(true)
    expect(queue.take(1)).toEqual([])
  })

  test("never replays a link to a new window", () => {
    const queue = createLinkQueue<number>()
    queue.push(1, "a")
    expect(queue.take(1)).toEqual(["a"])
    expect(queue.take(2)).toEqual([])
  })

  test("never replays a link after a reload, and holds new ones for the reloaded page", () => {
    const queue = createLinkQueue<number>()
    queue.push(1, "a")
    queue.take(1)
    queue.unload(1)
    expect(queue.push(1, "b")).toBe(false)
    expect(queue.take(1)).toEqual(["b"])
    queue.unload(1)
    expect(queue.take(1)).toEqual([])
  })

  test("drops a closed page's links and caps what waits", () => {
    const queue = createLinkQueue<number>()
    queue.push(1, "a")
    queue.close(1)
    expect(queue.take(1)).toEqual([])

    Array.from({ length: 20 }, (_, index) => queue.push(2, String(index)))
    expect(queue.take(2)).toEqual(Array.from({ length: 16 }, (_, index) => String(index + 4)))
  })
})
