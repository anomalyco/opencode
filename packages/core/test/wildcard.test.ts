import { describe, expect, test } from "bun:test"
import { match } from "@opencode-ai/core/util/wildcard"

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

  test("returns consistent results on repeated calls (compiled-pattern cache)", () => {
    for (let i = 0; i < 3; i++) {
      expect(match("echo hacheck a", "echo hacheck *")).toBe(true)
      expect(match("echo hacheck", "echo hacheck *")).toBe(true)
      expect(match("denied", "*")).toBe(true)
      expect(match("plain", "plain")).toBe(true)
    }
  })

  test("cache eviction keeps matching correct under churn", () => {
    for (let i = 0; i < 600; i++) {
      match(`cmd${i} arg`, `cmd${i} *`)
    }
    // re-match across the churn boundary
    expect(match("cmd0 arg", "cmd0 *")).toBe(true)
    expect(match("cmd599 arg", "cmd599 *")).toBe(true)
    expect(match("cmd0", "cmd0 *")).toBe(true)
  })
})
