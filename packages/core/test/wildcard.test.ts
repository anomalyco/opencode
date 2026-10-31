import { describe, expect, test } from "bun:test"
import { match } from "@opencode/core/util/wildcard"

describe("Wildcard.match", () => {
  test("matches literal patterns exactly", () => {
    expect(match("bash", "bash")).toBe(true)
    expect(match("bash", "zsh")).toBe(false)
  })

  test("treats * as any run of characters", () => {
    expect(match("echo hacheck a b c", "echo hacheck *")).toBe(true)
    expect(match("echo other", "echo hacheck *")).toBe(false)
  })

  test("trailing ' *' also matches the bare command", () => {
    expect(match("git", "git *")).toBe(true)
    expect(match("git push", "git *")).toBe(true)
    expect(match("gits", "git *")).toBe(false)
  })

  test("treats ? as a single character", () => {
    expect(match("cat", "ca?")).toBe(true)
    expect(match("caat", "ca?")).toBe(false)
  })

  test("escapes regex metacharacters in the pattern", () => {
    expect(match("file.txt", "file.txt")).toBe(true)
    expect(match("fileTtxt", "file.txt")).toBe(false)
    expect(match("a(b)", "a(b)")).toBe(true)
    expect(match("aXbYc", "a.b*c")).toBe(false)
  })

  test("normalizes backslashes on both sides", () => {
    expect(match("C:\\Users\\al\\repo", "C:/Users/al/*")).toBe(true)
    expect(match("C:/Users/al/repo", "C:\\Users\\al\\*")).toBe(true)
  })
})
