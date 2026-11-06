import { expect, test } from "bun:test"
import { groupItems } from "./use-filtered-list"

test("groups under one empty category without a groupBy", () => {
  expect(groupItems(["b", "a"], {})).toEqual([{ category: "", items: ["b", "a"] }])
})

test("keeps item order within a group and first-seen order between groups", () => {
  const items = [
    { name: "x1", group: "x" },
    { name: "y1", group: "y" },
    { name: "x2", group: "x" },
  ]

  expect(groupItems(items, { groupBy: (item) => item.group }).map((g) => [g.category, g.items.map((i) => i.name)])).toEqual([
    ["x", ["x1", "x2"]],
    ["y", ["y1"]],
  ])
})

test("lists numeric-looking categories first, as object keys do", () => {
  expect(groupItems(["b", "10", "a", "2"], { groupBy: (item) => item }).map((g) => g.category)).toEqual([
    "2",
    "10",
    "b",
    "a",
  ])
})

test("sorts items within groups and then the groups", () => {
  const groups = groupItems([3, 1, 4, 2], {
    groupBy: (n) => (n % 2 ? "odd" : "even"),
    sortBy: (a, b) => a - b,
    sortGroupsBy: (a, b) => a.category.localeCompare(b.category),
  })

  expect(groups).toEqual([
    { category: "even", items: [2, 4] },
    { category: "odd", items: [1, 3] },
  ])
})
