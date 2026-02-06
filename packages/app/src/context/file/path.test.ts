import { describe, expect, test } from "bun:test"
import { createPathHelpers, stripQueryAndHash, unquoteGitPath } from "./path"

describe("file path helpers", () => {
  test("normalizes file inputs against workspace root", () => {
    const path = createPathHelpers(() => "/repo")
    expect(path.normalize("file:///repo/src/app.ts?x=1#h")).toBe("src/app.ts")
    expect(path.normalize("/repo/src/app.ts")).toBe("src/app.ts")
    expect(path.normalize("./src/app.ts")).toBe("src/app.ts")
    expect(path.normalizeDir("src/components///")).toBe("src/components")
    expect(path.tab("src/app.ts")).toBe("file://src/app.ts")
    expect(path.pathFromTab("file://src/app.ts")).toBe("src/app.ts")
    expect(path.pathFromTab("other://src/app.ts")).toBeUndefined()
  })

  test("keeps query/hash stripping behavior stable", () => {
    expect(stripQueryAndHash("a/b.ts#L12?x=1")).toBe("a/b.ts")
    expect(stripQueryAndHash("a/b.ts?x=1#L12")).toBe("a/b.ts")
    expect(stripQueryAndHash("a/b.ts")).toBe("a/b.ts")
  })

  test("unquotes git escaped octal path strings", () => {
    expect(unquoteGitPath('"a/\\303\\251.txt"')).toBe("a/\u00e9.txt")
    expect(unquoteGitPath('"plain\\nname"')).toBe("plain\nname")
    expect(unquoteGitPath("a/b/c.ts")).toBe("a/b/c.ts")
  })
})
