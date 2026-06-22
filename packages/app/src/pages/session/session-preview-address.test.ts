import { describe, expect, test } from "bun:test"
import { formatBaseHost, formatEditablePath, resolveNavigatePath } from "./session-preview-address"

describe("formatBaseHost", () => {
  test("includes trailing slash", () => {
    expect(formatBaseHost("http://localhost:4400/foo")).toBe("localhost:4400/")
  })
})

describe("formatEditablePath", () => {
  test("root is empty", () => {
    expect(formatEditablePath({ pathname: "/", search: "", hash: "" })).toBe("")
  })

  test("strips leading slash and keeps query and hash", () => {
    expect(formatEditablePath({ pathname: "/foo", search: "?x=1", hash: "#y" })).toBe("foo?x=1#y")
  })
})

describe("resolveNavigatePath", () => {
  test("empty input navigates to root", () => {
    expect(resolveNavigatePath("http://localhost:4400", "")).toBe("http://localhost:4400/")
  })

  test("relative path resolves against base", () => {
    expect(resolveNavigatePath("http://localhost:4400", "bar")).toBe("http://localhost:4400/bar")
  })

  test("absolute path is preserved", () => {
    expect(resolveNavigatePath("http://localhost:4400", "/baz")).toBe("http://localhost:4400/baz")
  })
})
