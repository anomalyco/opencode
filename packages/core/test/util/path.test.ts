import { expect, test } from "bun:test"
import { getDirectory, getFileExtension, getFilename, truncateMiddle } from "@opencode-ai/core/util/path"

test("getFilename returns the last segment", () => {
  expect(getFilename("a/b/c.txt")).toBe("c.txt")
  expect(getFilename("C:\\x\\y.txt")).toBe("y.txt")
  expect(getFilename("a/b/")).toBe("b")
  expect(getFilename(undefined)).toBe("")
})

test("getDirectory returns the parent directory", () => {
  expect(getDirectory("src/file.txt")).toBe("src/")
  expect(getDirectory("a/b/c.txt")).toBe("a/b/")
  expect(getDirectory("C:\\x\\y.txt")).toBe("C:/x/")
})

test("getDirectory returns empty for a path with no parent", () => {
  expect(getDirectory("README.md")).toBe("")
  expect(getDirectory("file.txt")).toBe("")
  expect(getDirectory(undefined)).toBe("")
  expect(getDirectory("")).toBe("")
})

test("getDirectory keeps the root for absolute paths", () => {
  expect(getDirectory("/abs.txt")).toBe("/")
})

test("getFileExtension returns the extension without the dot", () => {
  expect(getFileExtension("a.txt")).toBe("txt")
  expect(getFileExtension("src/index.test.ts")).toBe("ts")
  expect(getFileExtension("archive.TAR.GZ")).toBe("GZ")
})

test("getFileExtension returns empty when there is no extension", () => {
  expect(getFileExtension("Makefile")).toBe("")
  expect(getFileExtension("LICENSE")).toBe("")
  expect(getFileExtension("src/Dockerfile")).toBe("")
  expect(getFileExtension(undefined)).toBe("")
})

test("getFileExtension treats a leading dot as a hidden file, not an extension", () => {
  expect(getFileExtension(".gitignore")).toBe("")
  expect(getFileExtension("src/.env")).toBe("")
  expect(getFileExtension(".eslintrc.json")).toBe("json")
})

test("getFileExtension ignores dots in parent directories", () => {
  expect(getFileExtension("my.dir/Makefile")).toBe("")
})

test("truncateMiddle never exceeds maxLength", () => {
  for (const maxLength of [1, 2, 3, 4, 5, 10]) {
    const result = truncateMiddle("abcdefghij", maxLength)
    expect(result.length).toBeLessThanOrEqual(maxLength)
  }
})

test("truncateMiddle keeps both ends when there is room", () => {
  expect(truncateMiddle("abcdefghij", 5)).toBe("ab…ij")
  expect(truncateMiddle("abcdefghij", 4)).toBe("ab…j")
  expect(truncateMiddle("abcdefghij", 3)).toBe("a…j")
})

test("truncateMiddle degrades to a prefix when no tail fits", () => {
  expect(truncateMiddle("abcdefghij", 2)).toBe("a…")
  expect(truncateMiddle("abcdefghij", 1)).toBe("…")
})

test("truncateMiddle returns short input unchanged", () => {
  expect(truncateMiddle("abc", 20)).toBe("abc")
  expect(truncateMiddle("", 20)).toBe("")
})
