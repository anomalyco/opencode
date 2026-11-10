import { describe, expect, test } from "bun:test"
import { Wildcard } from "../src/util/wildcard.js"

describe("Wildcard.match", () => {
  test("matches exact and glob patterns", () => {
    expect(Wildcard.match("read", "read")).toBe(true)
    expect(Wildcard.match("read", "re*")).toBe(true)
    expect(Wildcard.match("read", "write")).toBe(false)
    expect(Wildcard.match("cat", "c?t")).toBe(true)
  })

  test("treats regex metacharacters as literals", () => {
    expect(Wildcard.match("a.b", "a.b")).toBe(true)
    expect(Wildcard.match("axb", "a.b")).toBe(false)
  })

  test("normalizes backslashes in both input and pattern", () => {
    expect(Wildcard.match("a\\b", "a/b")).toBe(true)
    expect(Wildcard.match("a/b", "a\\b")).toBe(true)
  })

  test("keeps the optional trailing segment behavior", () => {
    expect(Wildcard.match("git", "git *")).toBe(true)
    expect(Wildcard.match("git status", "git *")).toBe(true)
    expect(Wildcard.match("gitx", "git *")).toBe(false)
  })

  test("stays consistent across repeated cached matches", () => {
    const pattern = "tool.*"
    const expected = Wildcard.match("tool.read", pattern)
    for (let index = 0; index < 1_000; index++) {
      expect(Wildcard.match("tool.read", pattern)).toBe(expected)
    }
  })

  test("keeps matching after many distinct patterns", () => {
    for (let index = 0; index < 1_100; index++) {
      Wildcard.match("value", `pattern-${index}`)
    }
    expect(Wildcard.match("tool.read", "tool.*")).toBe(true)
  })
})
