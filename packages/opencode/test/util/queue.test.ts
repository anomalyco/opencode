import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("preserves order across many dequeues", async () => {
    const q = new AsyncQueue<number>()

    for (let i = 0; i < 5000; i++) q.push(i)

    for (let i = 0; i < 5000; i++) {
      expect(await q.next()).toBe(i)
    }
  })

  test("delivers pushed values to waiting readers", async () => {
    const q = new AsyncQueue<string>()
    const next = q.next()

    q.push("ok")

    expect(await next).toBe("ok")
  })
})
