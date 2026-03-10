import { describe, expect, test } from "bun:test"
import { scan, splice } from "./autocomplete-slash"

describe("autocomplete slash", () => {
  test("scans the slash token at the caret", () => {
    expect(scan("/open", 5)).toEqual({ start: 0, end: 5, query: "open" })
    expect(scan("hello /ope", 10)).toEqual({ start: 6, end: 10, query: "ope" })
    expect(scan("hello/open", 10)).toEqual({ start: 5, end: 10, query: "open" })
    expect(scan("hello /nested/child tail", 19)).toEqual({ start: 6, end: 19, query: "nested/child" })
  })

  test("ignores spaces after the slash token", () => {
    expect(scan("hello /open ", 12)).toBeUndefined()
    expect(scan("hello world", 11)).toBeUndefined()
    expect(scan("/open", 0)).toBeUndefined()
  })

  test("splices inline slash text", () => {
    expect(splice("hello /open", 6, 11, "")).toBe("hello ")
    expect(splice("hello/open", 5, 10, "")).toBe("hello")
  })

  test("can move a custom command to the front", () => {
    const text = splice("hello /rev", 6, 10, "")
    expect(splice(text, 0, 0, "/review ")).toBe("/review hello ")
  })
})
