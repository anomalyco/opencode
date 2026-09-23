import { describe, expect, test } from "bun:test"
import { createWriteBehind } from "./write-behind"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("write-behind", () => {
  test("coalesces a burst into one batch with the latest value per key", async () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 10, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.set("b", 1)
    writer.set("a", 2)
    expect(writer.get("a")).toBe(2)
    expect(batches).toHaveLength(0)
    await wait(30)
    expect(batches).toHaveLength(1)
    expect([...batches[0]!]).toEqual([
      ["a", 2],
      ["b", 1],
    ])
    expect(writer.has("a")).toBe(false)
  })

  test("flush writes immediately and close stops accepting writes", () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 1_000, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.flush()
    expect(batches).toHaveLength(1)
    writer.set("b", 2)
    writer.close()
    expect(batches).toHaveLength(2)
    writer.set("c", 3)
    writer.flush()
    expect(batches).toHaveLength(2)
  })

  test("drop removes queued entries matching a predicate", () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 1_000, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.set("b", 2)
    writer.drop((value) => value === 1)
    writer.flush()
    expect([...batches[0]!]).toEqual([["b", 2]])
  })

  test("keeps a failed batch queued and retries it on the next flush", () => {
    const errors: unknown[] = []
    let fail = true
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({
      delay: 1_000,
      onError: (error) => errors.push(error),
      write: (batch) => {
        if (fail) throw new Error("disk full")
        batches.push(batch)
      },
    })
    writer.set("a", 1)
    writer.set("b", 1)
    writer.flush()
    expect(errors).toHaveLength(1)
    expect(writer.get("a")).toBe(1)
    fail = false
    writer.set("a", 2)
    writer.flush()
    expect([...batches[0]!].sort()).toEqual([
      ["a", 2],
      ["b", 1],
    ])
  })
})
