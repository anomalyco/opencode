import { describe, expect, test } from "bun:test"
import { shouldVirtualizeReviewDiff } from "./session-review-file-preview-v2-virtualize"

describe("shouldVirtualizeReviewDiff", () => {
  test("renders small diffs directly", () => {
    expect(shouldVirtualizeReviewDiff({ additionLines: 500, deletionLines: 500 })).toBe(false)
  })

  test("virtualizes large diffs", () => {
    expect(shouldVirtualizeReviewDiff({ additionLines: 501, deletionLines: 1 })).toBe(true)
    expect(shouldVirtualizeReviewDiff({ additionLines: 1, deletionLines: 501 })).toBe(true)
  })
})
