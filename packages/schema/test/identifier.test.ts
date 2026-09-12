import { describe, expect, test } from "bun:test"
import { create } from "../src/identifier"

// The most recent 48-bit wrap, 2026-08-14T11:19:55Z. Ids either side of it
// must still sort in time order.
const WRAP = 2 ** 36 * Math.floor(Date.now() / 2 ** 36)
const DAY = 86_400_000

describe("identifier", () => {
  test("ids are 26 characters", () => {
    expect(create(false)).toHaveLength(26)
    expect(create(true)).toHaveLength(26)
  })

  test("ascending ids sort in time order across the wrap", () => {
    expect(create(false, WRAP - DAY) < create(false, WRAP + DAY)).toBe(true)
  })

  test("descending ids sort in reverse time order across the wrap", () => {
    expect(create(true, WRAP + DAY) < create(true, WRAP - DAY)).toBe(true)
  })

  test("ascending ids sort in time order over four centuries", () => {
    const stamps = [0, 1_000_000_000_000, WRAP - 1, WRAP + 1, Date.parse("2400-01-01T00:00:00Z")]
    const ids = stamps.map((stamp) => create(false, stamp))
    expect(ids).toEqual([...ids].sort())
  })

  test("ids minted in the same millisecond stay ordered", () => {
    const ids = Array.from({ length: 32 }, () => create(false, WRAP))
    expect(ids).toEqual([...ids].sort())
  })
})
