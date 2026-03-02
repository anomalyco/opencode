import { describe, expect, test } from "bun:test"
import { splitAdd, splitEqual, splitNormalize, splitRemove, splitSibling } from "./terminal-split"

describe("terminal split groups", () => {
  test("creates a new group on first split", () => {
    expect(splitAdd({}, "one", "two")).toEqual({
      one: ["one", "two"],
    })
  })

  test("appends to existing group", () => {
    expect(
      splitAdd(
        {
          one: ["one", "two"],
        },
        "two",
        "three",
      ),
    ).toEqual({
      one: ["one", "two", "three"],
    })
  })

  test("rekeys group when removing head", () => {
    expect(
      splitRemove(
        {
          one: ["one", "two", "three"],
        },
        "one",
      ),
    ).toEqual({
      two: ["two", "three"],
    })
  })

  test("drops group when only one terminal remains", () => {
    expect(
      splitRemove(
        {
          one: ["one", "two"],
        },
        "two",
      ),
    ).toEqual({})
  })

  test("normalizes invalid and overlapping entries", () => {
    expect(
      splitNormalize(
        {
          one: ["one", "two", "two"],
          two: ["two", "three"],
          orphan: ["missing", "also-missing"],
        },
        ["one", "two", "three"],
      ),
    ).toEqual({
      one: ["one", "two"],
    })
  })

  test("returns sibling only when it exists", () => {
    const groups = {
      one: ["one", "two", "three"],
    }
    expect(splitSibling(groups, "two")).toBe("one")
    expect(splitSibling(groups, "two", ["two"])).toBeUndefined()
  })

  test("compares split groups by shape and order", () => {
    const a = { one: ["one", "two"] }
    const b = { one: ["one", "two"] }
    const c = { one: ["two", "one"] }
    expect(splitEqual(a, b)).toBe(true)
    expect(splitEqual(a, c)).toBe(false)
  })
})
