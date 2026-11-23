import { describe, expect, test } from "bun:test"
import { virtualizeLineThreshold } from "../../pierre/virtualizer"
import { shouldVirtualizeReviewDiff } from "./session-review-file-preview-v2-virtualize"

describe("shouldVirtualizeReviewDiff", () => {
  test("renders short diffs directly", () => {
    expect(
      shouldVirtualizeReviewDiff({ additionLines: virtualizeLineThreshold, deletionLines: virtualizeLineThreshold }),
    ).toBe(false)
  })

  test("virtualizes medium and large diffs", () => {
    expect(shouldVirtualizeReviewDiff({ additionLines: virtualizeLineThreshold + 1, deletionLines: 1 })).toBe(true)
    expect(shouldVirtualizeReviewDiff({ additionLines: 1, deletionLines: virtualizeLineThreshold + 1 })).toBe(true)
    expect(shouldVirtualizeReviewDiff({ additionLines: 480, deletionLines: 480 })).toBe(true)
  })
})
