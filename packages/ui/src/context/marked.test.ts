import { describe, expect, test } from "bun:test"
import { createMarkedDepsLoader } from "./marked"

describe("createMarkedDepsLoader", () => {
  test("defers loading until first use and memoizes the promise", async () => {
    let count = 0
    const value = { ok: true }
    const load = () => {
      count += 1
      return Promise.resolve(value)
    }

    const get = createMarkedDepsLoader(load)

    expect(count).toBe(0)

    const first = get()
    const second = get()

    expect(count).toBe(1)
    expect(first).toBe(second)
    expect(await first).toBe(value)

    const third = get()
    expect(count).toBe(1)
    expect(third).toBe(first)
  })
})
