import { describe, expect, test } from "bun:test"
import { normalizeBasePath, stripBasePath, withBasePath } from "./base-path"

describe("normalizeBasePath", () => {
  test("is empty at the root", () => {
    expect(normalizeBasePath(undefined)).toBe("")
    expect(normalizeBasePath("/")).toBe("")
    expect(normalizeBasePath("")).toBe("")
  })

  test("has a leading slash and no trailing slash", () => {
    expect(normalizeBasePath("/opencode/")).toBe("/opencode")
    expect(normalizeBasePath("opencode")).toBe("/opencode")
    expect(normalizeBasePath("//a/b//")).toBe("/a/b")
  })
})

describe("withBasePath", () => {
  test("leaves paths alone at the root", () => {
    expect(withBasePath("/new-session?x=1", "")).toBe("/new-session?x=1")
  })

  test("prefixes paths with the base", () => {
    expect(withBasePath("/", "/opencode")).toBe("/opencode/")
    expect(withBasePath("/server/a/session/b#m", "/opencode")).toBe("/opencode/server/a/session/b#m")
  })
})

describe("stripBasePath", () => {
  test("leaves paths alone at the root", () => {
    expect(stripBasePath("/new-session", "")).toBe("/new-session")
  })

  test("removes the base", () => {
    expect(stripBasePath("/opencode", "/opencode")).toBe("/")
    expect(stripBasePath("/opencode/", "/opencode")).toBe("/")
    expect(stripBasePath("/opencode?draftId=1", "/opencode")).toBe("/?draftId=1")
    expect(stripBasePath("/opencode/new-session#top", "/opencode")).toBe("/new-session#top")
  })

  test("keeps paths outside the base", () => {
    expect(stripBasePath("/opencode-other/x", "/opencode")).toBe("/opencode-other/x")
    expect(stripBasePath("/elsewhere", "/opencode")).toBe("/elsewhere")
  })

  test("round-trips with withBasePath", () => {
    for (const path of ["/", "/new-session", "/server/a/session/b?q=1#h"])
      expect(stripBasePath(withBasePath(path, "/opencode"), "/opencode")).toBe(path)
  })
})
