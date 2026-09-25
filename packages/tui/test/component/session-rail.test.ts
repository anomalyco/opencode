import { describe, expect, test } from "bun:test"
import { groupLabel, reanchor } from "../../src/component/session-rail"

const list = (ids: string[]) => ids.map((id) => ({ id }))

describe("session rail", () => {
  test("groups sessions by recency", () => {
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    const hour = 60 * 60 * 1000
    expect(groupLabel(startOfToday)).toBe("Today")
    expect(groupLabel(startOfToday - 12 * hour)).toBe("Yesterday")
    expect(groupLabel(startOfToday - 3 * 24 * hour)).toBe("7 days")
    expect(groupLabel(startOfToday - 30 * 24 * hour)).toBe("Older")
  })

  test("reanchor follows the anchored session when the list reorders", () => {
    const sessions = list(["a", "b", "c"])
    expect(reanchor(0, "c", sessions)).toBe(2)
    expect(reanchor(2, "a", sessions)).toBe(0)
  })

  test("reanchor clamps the cursor when the anchor is missing", () => {
    expect(reanchor(5, "z", list(["a", "b", "c"]))).toBe(2)
    expect(reanchor(1, "z", [])).toBe(0)
    expect(reanchor(1, undefined, list(["a", "b"]))).toBe(1)
  })
})
