import { describe, expect, test } from "bun:test"
import { truncateDiffs } from "../../src/util/truncate-diff"
import type { VcsFileDiff } from "@opencode-ai/schema/vcs"

describe("truncateDiffs", () => {
  test("returns all diffs when under file limit", () => {
    const diffs: VcsFileDiff[] = [
      { file: "a.ts", patch: "diff content", additions: 1, deletions: 0 },
      { file: "b.ts", patch: "diff content", additions: 2, deletions: 1 },
    ]

    const result = truncateDiffs(diffs, { maxFiles: 10 })

    expect(result.diffs).toHaveLength(2)
    expect(result.truncated.files).toBe(false)
    expect(result.truncated.patches).toBe(0)
    expect(result.truncated.totalFiles).toBe(2)
  })

  test("truncates files when over limit", () => {
    const diffs: VcsFileDiff[] = Array.from({ length: 15 }, (_, i) => ({
      file: `file-${i}.ts`,
      patch: "small diff",
      additions: 1,
      deletions: 0,
    }))

    const result = truncateDiffs(diffs, { maxFiles: 10 })

    expect(result.diffs).toHaveLength(10)
    expect(result.truncated.files).toBe(true)
    expect(result.truncated.totalFiles).toBe(15)
  })

  test("truncates large patches", () => {
    const smallPatch = "a".repeat(100)
    const largePatch = "b".repeat(200000) // 200KB
    const diffs: VcsFileDiff[] = [
      { file: "small.ts", patch: smallPatch, additions: 1, deletions: 0 },
      { file: "large.ts", patch: largePatch, additions: 1000, deletions: 500 },
    ]

    const result = truncateDiffs(diffs, { maxPatchBytes: 100000 })

    expect(result.diffs).toHaveLength(2)
    expect(result.diffs[0].patch).toBe(smallPatch)
    expect(result.diffs[1].patch).toContain("[Patch truncated:")
    expect(result.diffs[1].patch).toContain("exceeds")
    expect(result.truncated.patches).toBe(1)
  })

  test("uses default limits when not specified", () => {
    const diffs: VcsFileDiff[] = Array.from({ length: 5 }, (_, i) => ({
      file: `file-${i}.ts`,
      patch: "a".repeat(1000),
      additions: 1,
      deletions: 0,
    }))

    const result = truncateDiffs(diffs)

    expect(result.diffs).toHaveLength(5)
    expect(result.truncated.files).toBe(false)
    expect(result.truncated.patches).toBe(0)
  })

  test("handles diffs without patches", () => {
    const diffs: VcsFileDiff[] = [
      { file: "binary.png", additions: 0, deletions: 0 },
      { file: "text.ts", patch: "diff", additions: 1, deletions: 0 },
    ]

    const result = truncateDiffs(diffs)

    expect(result.diffs).toHaveLength(2)
    expect(result.diffs[0].patch).toBeUndefined()
    expect(result.diffs[1].patch).toBe("diff")
  })

  test("combines file and patch truncation", () => {
    const largePatch = "x".repeat(150000)
    const diffs: VcsFileDiff[] = Array.from({ length: 15 }, (_, i) => ({
      file: `file-${i}.ts`,
      patch: i < 5 ? largePatch : "small",
      additions: 10,
      deletions: 5,
    }))

    const result = truncateDiffs(diffs, { maxFiles: 10, maxPatchBytes: 100000 })

    expect(result.diffs).toHaveLength(10)
    expect(result.truncated.files).toBe(true)
    expect(result.truncated.totalFiles).toBe(15)
    expect(result.truncated.patches).toBe(5) // First 5 have large patches
  })
})
