import { expect, test } from "bun:test"
import { MAX_SUMMARY_TOTAL_PATCH_BYTES, limitSummaryDiffs } from "../../src/session/summary-diffs"

test("caps summary diffs to a bounded payload", () => {
  const diffs = Array.from({ length: 201 }, (_, index) => ({
    file: `src/file-${index}.ts`,
    patch: "@@ -1 +1 @@\n-old\n+new\n",
    additions: 1,
    deletions: 1,
    status: "modified" as const,
  }))

  const limited = limitSummaryDiffs(diffs)

  expect(limited).toHaveLength(200)
  expect(limited[0]).toEqual(diffs[0])
  expect(limited[199]).toEqual(diffs[199])
})

test("caps summary diffs by total patch bytes", () => {
  const patch = "x".repeat(MAX_SUMMARY_TOTAL_PATCH_BYTES / 2 + 1)
  const diffs = [
    {
      file: "src/large-1.ts",
      patch,
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    },
    {
      file: "src/large-2.ts",
      patch,
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    },
  ]

  const limited = limitSummaryDiffs(diffs)

  expect(limited).toHaveLength(2)
  expect(limited[0].patch).toBe(patch)
  expect(limited[1].patch).toBe("")
})
