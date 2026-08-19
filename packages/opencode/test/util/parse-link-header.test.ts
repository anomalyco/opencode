import { describe, expect, test } from "bun:test"
import { linkParam, parseLinkHeader } from "@opencode-ai/core/util/link-header"

describe("util.parseLinkHeader", () => {
  test("returns empty object for empty string", () => {
    expect(parseLinkHeader("")).toEqual({})
  })

  test("parses single link with rel", () => {
    const header = '<https://api.example.com/items?page=2>; rel="next"'
    expect(parseLinkHeader(header)).toEqual({
      next: "https://api.example.com/items?page=2",
    })
  })

  test("parses multiple links", () => {
    const header =
      '<https://api.example.com/items?page=1>; rel="prev", <https://api.example.com/items?page=3>; rel="next"'
    expect(parseLinkHeader(header)).toEqual({
      prev: "https://api.example.com/items?page=1",
      next: "https://api.example.com/items?page=3",
    })
  })

  test("handles unquoted rel values", () => {
    const header = "<https://example.com>; rel=next"
    expect(parseLinkHeader(header)).toEqual({
      next: "https://example.com",
    })
  })

  test("handles single-quoted rel values", () => {
    const header = "<https://example.com>; rel='next'"
    expect(parseLinkHeader(header)).toEqual({
      next: "https://example.com",
    })
  })

  test("ignores links without rel attribute", () => {
    const header = "<https://example.com>; type=text/html"
    expect(parseLinkHeader(header)).toEqual({})
  })

  test("handles malformed input gracefully", () => {
    expect(parseLinkHeader("not a valid header")).toEqual({})
    expect(parseLinkHeader("<<>>;;")).toEqual({})
  })

  test("handles extra whitespace", () => {
    const header = '  <https://example.com>  ;  rel="next"  '
    expect(parseLinkHeader(header)).toEqual({
      next: "https://example.com",
    })
  })

  test("extracts query params from parsed link urls", () => {
    const links = parseLinkHeader('<https://example.com/items?before=abc&limit=100>; rel="prev"')
    expect(linkParam(links.prev, "before")).toBe("abc")
    expect(linkParam(links.prev, "limit")).toBe("100")
  })

  test("returns undefined for invalid link param url", () => {
    expect(linkParam("not a url", "before")).toBeUndefined()
  })
})
