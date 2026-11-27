import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { createWriteBehind } from "./write-behind"

describe("write-behind", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("coalesces a burst into one batch with the latest value per key", () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 10, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.set("b", 1)
    writer.set("a", 2)
    expect(writer.get("a")).toBe(2)
    expect(batches).toHaveLength(0)
    jest.advanceTimersByTime(10)
    expect(batches).toHaveLength(1)
    expect([...batches[0]!]).toEqual([
      ["a", 2],
      ["b", 1],
    ])
    expect(writer.has("a")).toBe(false)
  })

  test("flush writes immediately and close refuses later writes", () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 1_000, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.flush()
    expect(batches).toHaveLength(1)
    writer.set("b", 2)
    writer.close()
    expect(batches).toHaveLength(2)
    expect(writer.closed()).toBe(true)
    expect(() => writer.set("c", 3)).toThrow("Write-behind buffer is closed")
    writer.flush()
    expect(batches).toHaveLength(2)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("retries a failed write on its own, backing off until it succeeds", () => {
    const errors: unknown[] = []
    const batches: Map<string, number>[] = []
    const failures = { left: 2 }

    const writer = createWriteBehind<number>({
      delay: 10,
      onError: (error) => errors.push(error),
      write: (batch) => {
        if (failures.left-- > 0) throw new Error("SQLITE_BUSY")
        batches.push(batch)
      },
    })

    writer.set("a", 1)
    jest.advanceTimersByTime(10)
    expect(errors).toHaveLength(1)
    expect(writer.get("a")).toBe(1)
    // The first retry waits the base delay, the second twice that.
    jest.advanceTimersByTime(10)
    expect(errors).toHaveLength(2)
    jest.advanceTimersByTime(19)
    expect(batches).toEqual([])
    jest.advanceTimersByTime(1)
    expect(batches).toEqual([new Map([["a", 1]])])
    expect(writer.has("a")).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("keeps the retry scheduled when reporting the failure throws", () => {
    const batches: Map<string, number>[] = []
    const failures = { left: 1 }

    const writer = createWriteBehind<number>({
      delay: 10,
      write: (batch) => {
        if (failures.left-- > 0) throw new Error("SQLITE_BUSY")
        batches.push(batch)
      },
    })

    writer.set("a", 1)
    expect(() => writer.flush()).toThrow("SQLITE_BUSY")
    jest.advanceTimersByTime(10)
    expect(batches).toEqual([new Map([["a", 1]])])
  })

  test("stops the timer when every queued row is dropped", () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 10, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.drop(() => true)
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(10)
    expect(batches).toEqual([])
  })
})
