import { describe, expect, test } from "bun:test"
import { isFileHref, pathFromFileHref } from "./file-link"

describe("pathFromFileHref", () => {
  test("parses unix file URLs", () => {
    expect(pathFromFileHref("file:///Users/me/project/file.md")).toBe("/Users/me/project/file.md")
    expect(pathFromFileHref("file:///tmp/opencode")).toBe("/tmp/opencode")
  })

  test("parses windows file URLs", () => {
    expect(pathFromFileHref("file:///C:/Users/me/file.md")).toBe("C:/Users/me/file.md")
  })

  test("accepts bare absolute paths", () => {
    expect(pathFromFileHref("/Users/me/project/file.md")).toBe("/Users/me/project/file.md")
    expect(pathFromFileHref("C:\\Users\\me\\file.md")).toBe("C:/Users/me/file.md")
  })

  test("strips line and column suffixes", () => {
    expect(pathFromFileHref("file:///Users/me/app.ts:12")).toBe("/Users/me/app.ts")
    expect(pathFromFileHref("/Users/me/app.ts:12:4")).toBe("/Users/me/app.ts")
  })

  test("rejects web URLs", () => {
    expect(pathFromFileHref("https://opencode.ai")).toBeUndefined()
    expect(pathFromFileHref("http://localhost:3000")).toBeUndefined()
  })
})

describe("isFileHref", () => {
  test("detects file targets", () => {
    expect(isFileHref("file:///tmp/x")).toBe(true)
    expect(isFileHref("/tmp/x")).toBe(true)
    expect(isFileHref("https://opencode.ai")).toBe(false)
  })
})
