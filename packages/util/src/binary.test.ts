import { describe, expect, test } from "bun:test"
import { Binary } from "./binary.js"

describe("binary search", () => {
  test("finds sorted values and their insertion points", () => {
    const values = [{ id: "a" }, { id: "c" }, { id: "e" }]
    expect(Binary.search(values, "c", (item) => item.id)).toEqual({ found: true, index: 1 })
    expect(Binary.search(values, "d", (item) => item.id)).toEqual({ found: false, index: 2 })
    expect(Binary.search(values, "0", (item) => item.id)).toEqual({ found: false, index: 0 })
  })

  test("inserts before the first matching sorted value", () => {
    const values = [{ id: "a" }, { id: "c" }, { id: "c" }, { id: "e" }]
    const item = { id: "c" }

    expect(Binary.insert(values, item, (value) => value.id)).toBe(values)
    expect(values).toEqual([{ id: "a" }, item, { id: "c" }, { id: "c" }, { id: "e" }])
  })
})
