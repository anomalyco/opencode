import { describe, expect, test } from "bun:test"
import { isDefaultTitle, totalCost } from "../../src/util/session"

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("sums cost across the session tree", () => {
    const sessions = [
      { id: "root", cost: 1 },
      { id: "a", parentID: "root", cost: 0.5 },
      { id: "b", parentID: "root" },
      { id: "c", parentID: "a", cost: 0.25 },
      { id: "other", cost: 10 },
      { id: "d", parentID: "other", cost: 3 },
    ]
    expect(totalCost(sessions, "root")).toBe(1.75)
    expect(totalCost(sessions, "a")).toBe(0.75)
    expect(totalCost(sessions, "b")).toBe(0)
    expect(totalCost(sessions, "missing")).toBe(0)
  })
})
