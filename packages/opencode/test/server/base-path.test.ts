import { describe, expect, test } from "bun:test"
import { normalizeBasePath, rewriteRequestBasePath, stripBasePath } from "../../src/server/base-path"

describe("base path helpers", () => {
  test("normalizes root and subpath values", () => {
    expect(normalizeBasePath(undefined)).toBe("")
    expect(normalizeBasePath("/")).toBe("")
    expect(normalizeBasePath("opencode")).toBe("/opencode")
    expect(normalizeBasePath("/opencode/")).toBe("/opencode")
  })

  test("strips the configured prefix when present", () => {
    expect(stripBasePath("/opencode", "/opencode")).toBe("/")
    expect(stripBasePath("/opencode/session/123", "/opencode")).toBe("/session/123")
    expect(stripBasePath("/session/123", "/opencode")).toBe("/session/123")
  })

  test("rewrites request URLs to stripped internal paths", () => {
    const request = rewriteRequestBasePath(new Request("http://localhost/opencode/session/123?cursor=4"), "/opencode")

    expect(new URL(request.url).pathname).toBe("/session/123")
    expect(new URL(request.url).searchParams.get("cursor")).toBe("4")
  })
})
