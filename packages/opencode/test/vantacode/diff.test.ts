import { describe, expect, test } from "bun:test"
import { diffLines, diffStat, renderDiff } from "@/vantacode/diff"

describe("diffLines", () => {
  test("detects a single changed line", () => {
    const lines = diffLines("a\nb\nc", "a\nB\nc")
    const stat = diffStat(lines)
    expect(stat.added).toBe(1)
    expect(stat.removed).toBe(1)
  })

  test("pure additions", () => {
    const lines = diffLines("a", "a\nb\nc")
    const stat = diffStat(lines)
    expect(stat.added).toBe(2)
    expect(stat.removed).toBe(0)
  })

  test("pure deletions", () => {
    const lines = diffLines("a\nb\nc", "a")
    const stat = diffStat(lines)
    expect(stat.added).toBe(0)
    expect(stat.removed).toBe(2)
  })

  test("identical text yields no changes", () => {
    const stat = diffStat(diffLines("same\ntext", "same\ntext"))
    expect(stat.added).toBe(0)
    expect(stat.removed).toBe(0)
  })
})

describe("renderDiff", () => {
  test("renders +/- markers without color", () => {
    const out = renderDiff("a\nb\nc", "a\nB\nc", { color: false })
    expect(out).toContain("- b")
    expect(out).toContain("+ B")
  })

  test("collapses long unchanged runs", () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n")
    const newText = oldText.replace("line0", "CHANGED")
    const out = renderDiff(oldText, newText, { color: false, context: 2 })
    expect(out).toContain("unchanged line")
  })

  test("includes a path header when provided", () => {
    const out = renderDiff("a", "b", { color: false, path: "src/x.ts" })
    expect(out).toContain("src/x.ts")
  })
})
