import { describe, expect, test } from "bun:test"
import { parseCodeFileRef } from "./markdown-file-ref"

describe("parseCodeFileRef", () => {
  test("parses relative path with line and trims punctuation", () => {
    expect(parseCodeFileRef("src/app.ts:42,", "")).toEqual({
      path: "src/app.ts",
      line: 42,
    })
  })

  test("parses hash-based line suffix", () => {
    expect(parseCodeFileRef("src/app.ts#L12", "")).toEqual({
      path: "src/app.ts",
      line: 12,
    })
  })

  test("parses file urls and strips project root", () => {
    expect(parseCodeFileRef("file:///Users/test/repo/src/main.ts:9", "/Users/test/repo")).toEqual({
      path: "src/main.ts",
      line: 9,
    })
  })

  test("normalizes windows paths", () => {
    expect(parseCodeFileRef("C:\\repo\\src\\main.ts:7", "")).toEqual({
      path: "C:/repo/src/main.ts",
      line: 7,
    })
  })

  test("parses windows file url paths", () => {
    expect(parseCodeFileRef("file:///C:/repo/src/main.ts#L11", "")).toEqual({
      path: "C:/repo/src/main.ts",
      line: 11,
    })
  })

  test("ignores non-path text", () => {
    expect(parseCodeFileRef("hello-world", "")).toBeUndefined()
  })
})
