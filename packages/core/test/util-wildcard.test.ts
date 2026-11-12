import { describe, expect, test } from "bun:test"
import { Wildcard } from "../src/util/wildcard.js"

describe("Wildcard.match", () => {
  test("matches literals exactly", () => {
    expect(Wildcard.match("read", "read")).toBe(true)
    expect(Wildcard.match("read", "write")).toBe(false)
  })

  test("supports * and ? globs", () => {
    expect(Wildcard.match("tool.use:read", "tool.use:*")).toBe(true)
    expect(Wildcard.match("abc", "a?c")).toBe(true)
    expect(Wildcard.match("ac", "a?c")).toBe(false)
    expect(Wildcard.match("tool.use:read", "tool.use:???")).toBe(false)
  })

  test("normalizes backslashes", () => {
    expect(Wildcard.match("src\\index.ts", "src/*.ts")).toBe(true)
    expect(Wildcard.match("src/index.ts", "src\\*.ts")).toBe(true)
  })

  test("escapes regex metacharacters in patterns", () => {
    expect(Wildcard.match("a+b", "a+b")).toBe(true)
    expect(Wildcard.match("aab", "a+b")).toBe(false)
    expect(Wildcard.match("release (1)", "release (1)")).toBe(true)
  })

  test("treats a trailing bare * as an optional suffix", () => {
    expect(Wildcard.match("git status", "git *")).toBe(true)
    expect(Wildcard.match("git", "git *")).toBe(true)
    expect(Wildcard.match("gitx", "git *")).toBe(false)
  })

  test("returns consistent results across repeated calls", () => {
    for (let i = 0; i < 10; i++) {
      expect(Wildcard.match("tool.use:read", "tool.use:*")).toBe(true)
      expect(Wildcard.match("tool.use:read", "tool.use:write")).toBe(false)
    }
  })
})
