import { describe, expect, test } from "bun:test"
import { createPathHelpers, stripQueryAndHash, unquoteGitPath } from "./path"

describe("file path helpers", () => {
  test.each([
    ["/repo", "file:///repo/src/app.ts?x=1#h", "src/app.ts"],
    ["/repo", "/repo/src/app.ts", "src/app.ts"],
    ["/repo", "./src/app.ts", "src/app.ts"],
    ["/repo", "file://src/app.ts", "src/app.ts"],
    ["C:\\repo", "C:\\repo\\src\\app.ts", "src\\app.ts"],
    ["C:\\repo", "C:/repo/src/app.ts", "src/app.ts"],
    ["C:\\repo", "file://C:/repo/src/app.ts", "src/app.ts"],
    ["C:\\repo", "c:\\repo\\src\\app.ts", "src\\app.ts"],
  ])("normalizes %p against the workspace root %p", (root, input, expected) => {
    expect(createPathHelpers(() => root).normalize(input)).toBe(expected)
  })

  test("keeps files outside the workspace absolute", () => {
    const posix = createPathHelpers(() => "/repo")
    expect(posix.normalize("/tmp/out/report.pdf")).toBe("/tmp/out/report.pdf")
    expect(posix.absolute("/tmp/out/report.pdf")).toBe(true)
    expect(posix.absolute("src/app.ts")).toBe(false)
    expect(posix.normalize("file:///tmp/out/report.pdf")).toBe("/tmp/out/report.pdf")
    expect(posix.normalize("/repository/x.ts")).toBe("/repository/x.ts")

    const windows = createPathHelpers(() => "C:\\repo")
    expect(windows.normalize("C:\\tmp\\font.ttf")).toBe("C:\\tmp\\font.ttf")
    expect(windows.normalize("file:///C:/tmp/font.ttf")).toBe("C:/tmp/font.ttf")
    expect(windows.absolute("C:/tmp/font.ttf")).toBe(true)
    expect(windows.normalize("file:///C:/repo/src/app.ts")).toBe("src/app.ts")
  })

  test.each([
    ["/repo", "src/components///", "src/components"],
    ["C:\\repo", "frontend\\", "frontend"],
    ["C:\\repo", "frontend\\src\\", "frontend/src"],
    ["C:\\repo", "C:\\repo\\frontend\\", "frontend"],
    ["C:/repo", "frontend\\src\\", "frontend/src"],
    ["\\\\server\\share", "\\\\server\\share\\frontend\\", "frontend"],
    ["/repo", "literal\\name\\", "literal\\name\\"],
    ["/repo", "literal\\name/", "literal\\name"],
  ])("normalizes the directory %p against the workspace root %p", (root, input, expected) => {
    expect(createPathHelpers(() => root).normalizeDir(input)).toBe(expected)
  })

  test.each([
    { name: "stripQueryAndHash", transform: stripQueryAndHash, input: "a/b.ts#L12?x=1", expected: "a/b.ts" },
    { name: "stripQueryAndHash", transform: stripQueryAndHash, input: "a/b.ts?x=1#L12", expected: "a/b.ts" },
    { name: "stripQueryAndHash", transform: stripQueryAndHash, input: "a/b.ts", expected: "a/b.ts" },
    { name: "unquoteGitPath", transform: unquoteGitPath, input: '"a/\\303\\251.txt"', expected: "a/\u00e9.txt" },
    { name: "unquoteGitPath", transform: unquoteGitPath, input: '"plain\\nname"', expected: "plain\nname" },
    { name: "unquoteGitPath", transform: unquoteGitPath, input: "a/b/c.ts", expected: "a/b/c.ts" },
  ])("$name($input) is $expected", ({ transform, input, expected }) => {
    expect(transform(input)).toBe(expected)
  })
})
