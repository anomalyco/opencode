import { describe, expect, test } from "bun:test"
import { listValue } from "./list-value"

describe("listValue", () => {
  test("returns arrays unchanged", () => {
    const input = [{ id: "a" }, { id: "b" }]
    expect(listValue(input)).toBe(input)
  })

  test("normalizes object maps to arrays", () => {
    expect(listValue({ a: { id: "a" }, b: { id: "b" } })).toEqual([{ id: "a" }, { id: "b" }])
  })

  test("returns an empty array for missing values", () => {
    expect(listValue(undefined)).toEqual([])
    expect(listValue(null)).toEqual([])
  })
})
