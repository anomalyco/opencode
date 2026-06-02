import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { dedupeSummaryDiffs } from "./message-timeline.diffs"

function diff(file: string | undefined, additions = 0): SnapshotFileDiff {
  return { file, additions, deletions: 0 } as unknown as SnapshotFileDiff
}

describe("dedupeSummaryDiffs", () => {
  test("returns empty for undefined input", () => {
    expect(dedupeSummaryDiffs(undefined)).toEqual([])
  })

  test("drops entries without a file path", () => {
    const result = dedupeSummaryDiffs([diff("a.ts"), diff(undefined), diff("b.ts")])
    expect(result.map((d) => d.file)).toEqual(["a.ts", "b.ts"])
  })

  test("keeps the last entry per file, preserving original order", () => {
    const result = dedupeSummaryDiffs([
      diff("a.ts", 1),
      diff("b.ts", 1),
      diff("a.ts", 2),
      diff("c.ts", 1),
      diff("b.ts", 2),
    ])
    expect(result.map((d) => [d.file, (d as { additions: number }).additions])).toEqual([
      ["a.ts", 2],
      ["c.ts", 1],
      ["b.ts", 2],
    ])
  })

  test("dedupes a large all-unique input quickly (regression guard for O(n^2) hang)", () => {
    const input = Array.from({ length: 25_000 }, (_, i) => diff(`file-${i}.ts`))
    const start = performance.now()
    const result = dedupeSummaryDiffs(input)
    const elapsed = performance.now() - start
    expect(result.length).toBe(25_000)
    expect(result[0].file).toBe("file-0.ts")
    expect(result[result.length - 1].file).toBe("file-24999.ts")
    // The old O(n^2) implementation took seconds/minutes on this size and hung the renderer.
    expect(elapsed).toBeLessThan(1_000)
  })
})
