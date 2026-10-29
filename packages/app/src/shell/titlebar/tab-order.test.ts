import { expect, test } from "bun:test"
import { adjacentTabKey, mergeVisibleTabOrder, orderTabsByRecency } from "./tab-order"

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

test("orders tabs by last activity and keeps stored order for ties", () => {
  const tabs = ["a", "b", "c", "d"].map((id) => ({ id }))
  const times: Record<string, number> = { a: 10, b: 40, c: 40 }

  expect(orderTabsByRecency(tabs, (tab) => times[tab.id]).map((tab) => tab.id)).toEqual(["b", "c", "a", "d"])
  expect(orderTabsByRecency(tabs, () => undefined).map((tab) => tab.id)).toEqual(["a", "b", "c", "d"])
})

test("does not mutate the stored tab list while ordering", () => {
  const tabs = ["a", "b"].map((id) => ({ id }))

  orderTabsByRecency(tabs, (tab) => (tab.id === "a" ? 1 : 2))

  expect(tabs.map((tab) => tab.id)).toEqual(["a", "b"])
})
