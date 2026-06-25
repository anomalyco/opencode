import { expect, test } from "bun:test"
import { limitSummaryDiffs } from "../../src/session/summary-diffs"

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
