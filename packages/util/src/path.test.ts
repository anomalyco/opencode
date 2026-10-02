import { describe, expect, test } from "bun:test"
import { encodeFilePath, getDirectory, getFilename, getFilenameTruncated, truncateMiddle } from "./path.js"

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

describe("encodeFilePath", () => {
  const rows = [
    ["/home/user/project/README.md", "/home/user/project/README.md"],
    ["/home/user/file#name with spaces.txt", "/home/user/file%23name%20with%20spaces.txt"],
    ["/path/to/file#with?special%chars&more.txt", "/path/to/file%23with%3Fspecial%25chars%26more.txt"],
    ["/path/to/file?name.txt", "/path/to/file%3Fname.txt"],
    ["/path/to/file%name.txt", "/path/to/file%25name.txt"],
    ["/home/user/文档/README.md", "/home/user/%E6%96%87%E6%A1%A3/README.md"],
    ["/", "/"],
    ["", ""],
    ["//path//to///file.txt", "//path//to///file.txt"],
    ["src/components/App.tsx", "src/components/App.tsx"],
    ["src\\components\\App.tsx", "src/components/App.tsx"],
    ["D:\\dev\\projects\\opencode\\README.bs.md", "/D:/dev/projects/opencode/README.bs.md"],
    ["D:\\dev\\projects\\opencode/README.bs.md", "/D:/dev/projects/opencode/README.bs.md"],
    ["C:\\Program Files\\MyApp\\file with spaces.txt", "/C:/Program%20Files/MyApp/file%20with%20spaces.txt"],
    ["D:\\projects\\file#name with ?marks.txt", "/D:/projects/file%23name%20with%20%3Fmarks.txt"],
    ["C:\\", "/C:/"],
    ["c:\\users\\test\\file.txt", "/c:/users/test/file.txt"],
    ["D:", "/D:"],
    ["C:\\Users\\test\\", "/C:/Users/test/"],
    ["C:\\Users\\..\\test\\.\\file.txt", "/C:/Users/../test/./file.txt"],
    ["/D:/path/file.txt", "/D:/path/file.txt"],
  ] as const

  test.each(rows)("encodes %p as %p", (input, expected) => {
    expect(encodeFilePath(input)).toBe(expected)
  })

  test("every encoded path forms a file URL that keeps its query", () => {
    rows.forEach(([input]) => {
      const url = new URL(`file://${encodeFilePath(input)}?start=10`)
      expect(url.protocol).toBe("file:")
      expect(url.searchParams.get("start")).toBe("10")
    })
  })
})
