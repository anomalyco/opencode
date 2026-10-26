import { expect, test } from "bun:test"
import { adjacentTabKey, mergeVisibleTabOrder } from "./tab-order"

test("finds the nearest accepted tab in either direction, wrapping around", () => {
  const order = ["a", "b", "c", "d", "e"]
  const unread = new Set(["a", "d"])

  expect(adjacentTabKey(order, "b", 1, (key) => unread.has(key))).toBe("d")
  expect(adjacentTabKey(order, "b", -1, (key) => unread.has(key))).toBe("a")
  expect(adjacentTabKey(order, "e", 1, (key) => unread.has(key))).toBe("a")
  expect(adjacentTabKey(order, "a", -1, (key) => unread.has(key))).toBe("d")
  expect(adjacentTabKey(order, "a", 1, (key) => key === "a")).toBeUndefined()
})

test("merges reordered visible tabs around hidden tabs", () => {
  expect(mergeVisibleTabOrder(["a", "hidden", "b", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual([
    "c",
    "hidden",
    "a",
    "b",
  ])
})
