import { describe, expect, test } from "bun:test"
import { getDirectory, getFilename, getFilenameTruncated, truncateMiddle } from "./path.js"

describe("client paths", () => {
  test("reads POSIX and Windows paths with the same rules", () => {
    expect(getFilename("/repo/src/index.ts")).toBe("index.ts")
    expect(getFilename("C:\\repo\\src\\index.ts\\")).toBe("index.ts")
    expect(getDirectory("/repo/src/index.ts")).toBe("/repo/src/")
    expect(getDirectory("C:\\repo\\src\\index.ts")).toBe("C:/repo/src/")
  })

  test("preserves root, UNC, mixed, and single-segment behavior", () => {
    expect(getFilename("\\\\server\\share\\file")).toBe("file")
    expect(getDirectory("\\\\server\\share\\file")).toBe("//server/share/")
    expect(getDirectory("C:\\repo/src\\file")).toBe("C:/repo/src/")
    expect(getDirectory("file")).toBe("/")
    expect(getFilename(undefined)).toBe("")
    expect(getDirectory("")).toBe("")
  })

  test.each([
    ["/repo/src/index.ts///", "index.ts"],
    ["C:\\repo\\src\\index.ts", "index.ts"],
    ["C:\\repo/src\\file", "file"],
    ["C:/repo\\src/file/\\", "file"],
    ["/", ""],
    ["\\", ""],
    ["/\\/\\", ""],
    ["C:\\", "C:"],
    ["file", "file"],
    ["", ""],
  ])("reads the filename from %j", (path, filename) => {
    expect(getFilename(path)).toBe(filename)
  })

  test("keeps filename truncation stable", () => {
    expect(getFilenameTruncated("/repo/long-component-name.tsx", 16)).toBe("long-compon….tsx")
    expect(truncateMiddle("abcdefghijklmnop", 9)).toBe("abcd…mnop")
  })
})
