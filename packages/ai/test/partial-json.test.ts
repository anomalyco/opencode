import { describe, expect, test } from "bun:test"
import { Allow, MalformedJSON, PartialJSON, parse } from "../src/protocols/utils/partial-json.js"

describe("partial JSON", () => {
  test("parses complete JSON", () => {
    expect(parse('{"key":"value","items":[1,true,null]}')).toEqual({
      key: "value",
      items: [1, true, null],
    })

    const object = parse('{"__proto__":{"safe":true}}') as Record<string, unknown>
    expect(Object.hasOwn(object, "__proto__")).toBe(true)
  })

  test("parses partial strings", () => {
    expect(parse('"hello')).toBe("hello")
    expect(parse('"hello \\u12')).toBe("hello ")
    expect(() => parse('"hello', ~Allow.STR)).toThrow(PartialJSON)
  })

  test("repairs invalid escapes and raw control characters", () => {
    expect(parse('{"path":"A\\H","text":"first\tsecond"}')).toEqual({
      path: "A\\H",
      text: "first\tsecond",
    })
  })

  test("preserves prototype keys in partial objects", () => {
    const object = parse('{"__proto__":{"safe":true}') as Record<string, unknown>

    expect(Object.hasOwn(object, "__proto__")).toBe(true)
    expect(Object.getPrototypeOf(object)).toBe(Object.prototype)
    expect(object.__proto__).toEqual({ safe: true })
  })

  test("controls partial collection values independently", () => {
    expect(parse('["', Allow.ARR)).toEqual([])
    expect(parse('["', Allow.ARR | Allow.STR)).toEqual([""])
    expect(parse('{"key":"', Allow.OBJ)).toEqual({})
    expect(parse('{"key":"', Allow.OBJ | Allow.STR)).toEqual({ key: "" })
  })

  test("parses partial literals and numbers", () => {
    expect(parse("nu", Allow.NULL)).toBeNull()
    expect(parse("tr", Allow.BOOL)).toBe(true)
    expect(parse("fa", Allow.BOOL)).toBe(false)
    expect(parse("1e", Allow.NUM)).toBe(1)
  })

  test("distinguishes disallowed partial values from malformed values", () => {
    expect(() => parse("[", Allow.STR)).toThrow(PartialJSON)
    expect(() => parse("n", ~Allow.NULL)).toThrow(MalformedJSON)
  })

  test("rejects empty input", () => {
    expect(() => parse("  ")).toThrow("is empty")
  })
})
