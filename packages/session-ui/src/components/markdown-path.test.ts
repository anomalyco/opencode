import { describe, expect, test } from "bun:test"
import { codePath } from "./markdown-path"

describe("codePath", () => {
  test("plain path", () => {
    expect(codePath("packages/session-ui/src/components/markdown.tsx")).toEqual({
      path: "packages/session-ui/src/components/markdown.tsx",
    })
  })

  test("path with line number", () => {
    expect(codePath("packages/app/src/app.tsx:301")).toEqual({
      path: "packages/app/src/app.tsx",
      line: 301,
    })
  })

  test("path with line and column", () => {
    expect(codePath("src/app.tsx:301:7")).toEqual({
      path: "src/app.tsx",
      line: 301,
    })
  })

  test("windows path with line number", () => {
    expect(codePath("C:\\dev\\app\\src\\app.ts:12")).toEqual({
      path: "C:\\dev\\app\\src\\app.ts",
      line: 12,
    })
  })

  test("windows path without line number keeps drive colon", () => {
    expect(codePath("C:\\dev\\app\\src\\app.ts")).toEqual({
      path: "C:\\dev\\app\\src\\app.ts",
    })
  })

  test("rejects urls", () => {
    expect(codePath("https://github.com/anomalyco/opencode")).toBeUndefined()
    expect(codePath("http://example.com/foo.ts:1")).toBeUndefined()
  })

  test("rejects whitespace", () => {
    expect(codePath("src/foo.ts bar")).toBeUndefined()
  })

  test("rejects empty input", () => {
    expect(codePath("")).toBeUndefined()
    expect(codePath(undefined)).toBeUndefined()
    expect(codePath(null)).toBeUndefined()
  })

  test("trims surrounding whitespace", () => {
    expect(codePath("  src/app.ts:3  ")).toEqual({ path: "src/app.ts", line: 3 })
  })

  test("strips invalid line references", () => {
    expect(codePath("app.ts:0")).toEqual({ path: "app.ts" })
  })
})
