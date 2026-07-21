import { describe, expect, test } from "bun:test"
import { promoteOrder, reconcileOrder, stepOrder } from "./tab-order"

describe("tab order promote", () => {
  test("moves a key to the front", () => {
    expect(promoteOrder(["a", "b", "c"], "c")).toEqual(["c", "a", "b"])
  })

  test("adds an unseen key to the front", () => {
    expect(promoteOrder(["a", "b"], "c")).toEqual(["c", "a", "b"])
  })

  test("drops duplicates", () => {
    expect(promoteOrder(["a", "b", "a"], "a")).toEqual(["a", "b"])
  })
})

describe("tab order reconcile", () => {
  test("drops closed tabs and keeps order", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b"])).toEqual(["a", "b"])
  })

  test("appends newly-seen keys at the back", () => {
    expect(reconcileOrder(["a"], ["a", "b", "c"])).toEqual(["a", "b", "c"])
  })

  test("dedupes", () => {
    expect(reconcileOrder(["a", "a", "b"], ["a", "b"])).toEqual(["a", "b"])
  })
})

describe("tab order step", () => {
  const order = ["a", "b", "c"]

  test("steps toward older tabs", () => {
    expect(stepOrder(order, "a", 1)).toBe("b")
    expect(stepOrder(order, "a", 2)).toBe("c")
  })

  test("wraps forward", () => {
    expect(stepOrder(order, "a", 3)).toBe("a")
    expect(stepOrder(order, "c", 1)).toBe("a")
  })

  test("steps toward newer tabs and wraps", () => {
    expect(stepOrder(order, "a", -1)).toBe("c")
    expect(stepOrder(order, "b", -1)).toBe("a")
  })

  test("anchors on active even when not at the front", () => {
    expect(stepOrder(order, "b", 1)).toBe("c")
  })

  test("falls back to the front when active is unknown", () => {
    expect(stepOrder(order, "missing", 1)).toBe("b")
    expect(stepOrder(order, undefined, 1)).toBe("b")
  })

  test("returns undefined for an empty order", () => {
    expect(stepOrder([], "a", 1)).toBeUndefined()
  })
})
