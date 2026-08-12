import { describe, expect, test } from "bun:test"
import { jsonKeys, parseJson } from "./json-viewer"

describe("parseJson", () => {
  test.each(["false", "0", '""', "null"])("accepts root value %s", (json) => {
    expect(parseJson(json).valid).toBe(true)
  })

  test("returns the parsed value", () => {
    expect(parseJson('{"message":"hello"}')).toEqual({ value: { message: "hello" }, valid: true })
  })

  test("marks malformed JSON as invalid", () => {
    expect(parseJson("{malformed")).toEqual({ value: null, valid: false })
  })
})

describe("jsonKeys", () => {
  test("returns stable string keys for arrays", () => {
    expect(jsonKeys(["first", "second"])).toEqual(["0", "1"])
  })

  test("returns object keys without rebuilding value entries", () => {
    expect(jsonKeys({ first: 1, second: 2 })).toEqual(["first", "second"])
  })

  test("returns no keys for primitive and empty values", () => {
    expect(jsonKeys(false)).toEqual([])
    expect(jsonKeys([])).toEqual([])
    expect(jsonKeys({})).toEqual([])
  })
})
