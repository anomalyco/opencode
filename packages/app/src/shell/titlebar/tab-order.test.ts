import { describe, expect, test } from "bun:test"
import { adjacentTabKey, mergeVisibleTabOrder } from "./tab-order"

describe("adjacentTabKey", () => {
  test("follows the visible left-to-right order", () => {
    expect(adjacentTabKey(["c", "a", "b"], "c", 1)).toBe("a")
    expect(adjacentTabKey(["c", "a", "b"], "a", -1)).toBe("c")
  })

  test("skips tabs omitted from the visible order", () => {
    expect(adjacentTabKey(["a", "c"], "a", 1)).toBe("c")
    expect(adjacentTabKey(["a", "c"], "c", 1)).toBe("a")
  })
})

test("merges reordered visible tabs around hidden tabs", () => {
  expect(mergeVisibleTabOrder(["a", "hidden", "b", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual([
    "c",
    "hidden",
    "a",
    "b",
  ])
})
