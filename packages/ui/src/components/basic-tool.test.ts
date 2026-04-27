import { describe, expect, test } from "bun:test"
import { args, glyph, label } from "./basic-tool"

describe("basic-tool label", () => {
  test("prefers command previews for terminal-style tools", () => {
    expect(label({ command: "rg --files src", path: "/tmp" })).toBe("rg --files src")
  })

  test("falls back to first url entry", () => {
    expect(label({ urls: ["https://opencode.ai/docs", "https://example.com"] })).toBe("https://opencode.ai/docs")
  })
})

describe("basic-tool args", () => {
  test("skips large content fields and keeps small flags", () => {
    expect(
      args({
        path: "/tmp/out.ts",
        content: "const value = 'very long body'",
        mode: "replace",
        limit: 5,
      }),
    ).toEqual(["mode=replace", "limit=5"])
  })

  test("clips long values", () => {
    const val = args({
      note: "x".repeat(80),
    })[0]
    expect(val).toBe(`note=${"x".repeat(45)}...`)
  })
})

describe("basic-tool glyph", () => {
  test("maps hermes file and terminal tools to native icons", () => {
    expect(glyph("read_file")).toBe("glasses")
    expect(glyph("search_files")).toBe("magnifying-glass-menu")
    expect(glyph("terminal")).toBe("console")
    expect(glyph("write_file")).toBe("code-lines")
  })
})
