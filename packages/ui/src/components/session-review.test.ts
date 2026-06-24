import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { listReviewDiffs } from "./session-review-diffs"

const diff = {
  file: "src/app.ts",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
  status: "modified",
} satisfies SnapshotFileDiff

describe("listReviewDiffs", () => {
  test("keeps valid arrays", () => {
    expect(listReviewDiffs([diff])).toEqual([diff])
  })

  test("normalizes single and keyed diff payloads", () => {
    expect(listReviewDiffs(diff)).toEqual([diff])
    expect(listReviewDiffs({ app: diff })).toEqual([diff])
  })

  test("drops non-diff payloads", () => {
    expect(listReviewDiffs(null)).toEqual([])
    expect(listReviewDiffs({ diffs: "not an array" })).toEqual([])
  })
})
