import { describe, expect, test } from "bun:test"
import { withUniqueUsersFallback } from "./stat"

describe("withUniqueUsersFallback", () => {
  test("writes with unique users first", async () => {
    const calls: boolean[] = []

    const result = await withUniqueUsersFallback(async (includeUniqueUsers) => {
      calls.push(includeUniqueUsers)
      return "written"
    })

    expect(result).toBe("written")
    expect(calls).toEqual([true])
  })

  test("retries without unique users only for the missing column error", async () => {
    const calls: boolean[] = []

    const result = await withUniqueUsersFallback(async (includeUniqueUsers) => {
      calls.push(includeUniqueUsers)
      if (includeUniqueUsers) throw new Error("Unknown column 'unique_users' in 'field list'")
      return "written"
    })

    expect(result).toBe("written")
    expect(calls).toEqual([true, false])
  })

  test("rethrows unrelated errors without retrying", async () => {
    const calls: boolean[] = []
    const error = new Error("connection failed")

    const result = withUniqueUsersFallback(async (includeUniqueUsers) => {
      calls.push(includeUniqueUsers)
      throw error
    })

    await expect(result).rejects.toBe(error)
    expect(calls).toEqual([true])
  })

  test("rethrows an error from the fallback write", async () => {
    const calls: boolean[] = []
    const error = new Error("fallback failed")

    const result = withUniqueUsersFallback(async (includeUniqueUsers) => {
      calls.push(includeUniqueUsers)
      if (includeUniqueUsers) throw new Error("Unknown column 'unique_users' in 'field list'")
      throw error
    })

    await expect(result).rejects.toBe(error)
    expect(calls).toEqual([true, false])
  })
})
