import { test, expect, describe } from "bun:test"
import { describeState, snippet, clampPaging, buildSearchQuery, formatPr, type PR } from "../lib/github-pr-search.lib"

describe("describeState", () => {
  test("merged when pull_request.merged_at is set", () => {
    expect(describeState({ pull_request: { merged_at: "2024-01-01" }, state: "closed" } as PR)).toBe("merged")
  })
  test("falls back to the GitHub state", () => {
    expect(describeState({ state: "open" } as PR)).toBe("open")
  })
  test("unknown when state missing", () => {
    expect(describeState({} as PR)).toBe("unknown")
  })
})

describe("snippet", () => {
  test("empty for null/empty body", () => {
    expect(snippet(null)).toBe("")
    expect(snippet("")).toBe("")
  })
  test("collapses whitespace", () => {
    expect(snippet("a\n\n  b   c")).toBe("a b c")
  })
  test("truncates long bodies with an ellipsis", () => {
    const out = snippet("x".repeat(250))
    expect(out.length).toBe(201)
    expect(out.endsWith("…")).toBe(true)
  })
})

describe("clampPaging", () => {
  test("passes valid values through", () => {
    expect(clampPaging(10, 1)).toEqual({ perPage: 10, page: 1 })
  })
  test("clamps page below 1", () => {
    expect(clampPaging(10, 0)).toEqual({ perPage: 10, page: 1 })
  })
  test("caps perPage at 100 and floors at 1", () => {
    expect(clampPaging(500, 3)).toEqual({ perPage: 100, page: 3 })
    expect(clampPaging(0, 1)).toEqual({ perPage: 1, page: 1 })
  })
  test("truncates fractional input", () => {
    expect(clampPaging(10.9, 2.7)).toEqual({ perPage: 10, page: 2 })
  })
})

describe("buildSearchQuery", () => {
  test("includes the state qualifier", () => {
    expect(buildSearchQuery("foo", "o", "r", "open")).toBe("foo repo:o/r type:pr state:open")
  })
  test("omits the state qualifier for 'all'", () => {
    expect(buildSearchQuery("foo", "o", "r", "all")).toBe("foo repo:o/r type:pr")
  })
})

describe("formatPr", () => {
  test("renders number, state, author, labels, url and snippet", () => {
    const pr = {
      number: 7,
      title: "Fix",
      html_url: "u",
      state: "open",
      user: { login: "a" },
      labels: [{ name: "bug" }],
      body: "hi",
    } as PR
    expect(formatPr(pr)).toBe("#7 — Fix\nstate: open · author: @a · labels: bug\nu\nhi")
  })
  test("handles missing author and labels", () => {
    const pr = { number: 1, title: "T", html_url: "u", state: "closed" } as PR
    expect(formatPr(pr)).toBe("#1 — T\nstate: closed · author: unknown\nu")
  })
})
