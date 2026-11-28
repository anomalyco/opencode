import { describe, expect, test } from "bun:test"
import { Wildcard } from "@opencode/core/util/wildcard"

describe("Wildcard.match", () => {
  test("matches literals, glob tokens, and trailing space-star", () => {
    expect(Wildcard.match("bash", "bash")).toBe(true)
    expect(Wildcard.match("bash", "zsh")).toBe(false)
    expect(Wildcard.match("file1.txt", "file?.txt")).toBe(true)
    expect(Wildcard.match("file12.txt", "file?.txt")).toBe(false)
    expect(Wildcard.match("git", "git *")).toBe(true)
    expect(Wildcard.match("git push", "git *")).toBe(true)
    expect(Wildcard.match("gits", "git *")).toBe(false)
    expect(Wildcard.match("first\nsecond", "first*")).toBe(true)
  })

  test("treats regex metacharacters as literals", () => {
    expect(Wildcard.match("file.txt", "file.txt")).toBe(true)
    expect(Wildcard.match("fileTtxt", "file.txt")).toBe(false)
    expect(Wildcard.match("a(b)", "a(b)")).toBe(true)
    expect(Wildcard.match("a+b(c)[d]{e}|f^g$h", "a+b(c)[d]{e}|f^g$h")).toBe(true)
    expect(Wildcard.match("browser", "b.owser")).toBe(false)
    expect(Wildcard.match("b.owser", "b.owser")).toBe(true)
  })

  test("normalizes backslashes on both sides", () => {
    expect(Wildcard.match("C:\\Users\\al\\repo", "C:/Users/al/*")).toBe(true)
    expect(Wildcard.match("C:/Users/al/repo", "C:\\Users\\al\\*")).toBe(true)
  })

  test("ignoreCase and platform flags keep case-sensitivity distinct", () => {
    expect(Wildcard.match(".OPENCODE/x", ".opencode/*", true)).toBe(true)
    expect(Wildcard.match("Tabs.List", "tabs.list", true)).toBe(true)
    expect(Wildcard.match(".OPENCODE/x", ".opencode/*")).toBe(process.platform === "win32")
    expect(Wildcard.match("Tabs.List", "tabs.list")).toBe(process.platform === "win32")
  })
})
