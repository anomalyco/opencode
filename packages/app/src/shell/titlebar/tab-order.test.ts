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

test("orders tabs by recent activity and leaves unknown tabs at the end", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]
  const times: Record<string, number | undefined> = { a: 10, c: 30 }

  expect(orderTabsByRecency(tabs, (tab) => times[tab.id]).map((tab) => tab.id)).toEqual(["c", "a", "b", "d"])
})

test("keeps the stored order for tabs with the same activity", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }]

  expect(orderTabsByRecency(tabs, () => 5).map((tab) => tab.id)).toEqual(["a", "b", "c"])
})
