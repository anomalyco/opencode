import { describe, expect, test } from "bun:test"
import { Identifier } from "../src/id/id"

describe("Identifier.timestamp", () => {
  test("round-trips the time an ascending id was minted", () => {
    const before = Date.now()
    const decoded = Identifier.timestamp(Identifier.ascending("session"))
    expect(decoded).toBeGreaterThanOrEqual(before)
    expect(decoded).toBeLessThanOrEqual(Date.now())
  })

  test("round-trips an explicit timestamp", () => {
    const stamp = Date.parse("2026-09-03T04:39:56.208Z")
    expect(Identifier.timestamp(Identifier.create("ses", "ascending", stamp))).toBe(stamp)
  })
})
