import { describe, expect, test } from "bun:test"
import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import { sessionReviewDiffsReady, shouldLoadSessionReviewDiff } from "./review-diff-state"

describe("session review diff state", () => {
  test("keeps malformed review diffs in a not-ready state", () => {
    const valid = [{ file: "a.ts", before: "", after: "", additions: 1, deletions: 0 }] as FileDiff[]

    expect(
      sessionReviewDiffsReady({
        sessionID: "ses_1",
        hasSessionReview: true,
        sessionDiff: {} as never,
      }),
    ).toBe(false)
    expect(
      sessionReviewDiffsReady({
        sessionID: "ses_1",
        hasSessionReview: true,
        sessionDiff: valid,
      }),
    ).toBe(true)
    expect(
      sessionReviewDiffsReady({
        sessionID: "ses_1",
        hasSessionReview: false,
        sessionDiff: {} as never,
      }),
    ).toBe(true)
  })

  test("requests review diffs when review is open and cache is malformed", () => {
    const valid = [{ file: "a.ts", before: "", after: "", additions: 1, deletions: 0 }] as FileDiff[]

    expect(
      shouldLoadSessionReviewDiff({
        sessionID: "ses_1",
        wantsReview: true,
        sessionDiff: {} as never,
        syncStatus: "complete",
      }),
    ).toBe(true)
    expect(
      shouldLoadSessionReviewDiff({
        sessionID: "ses_1",
        wantsReview: true,
        sessionDiff: valid,
        syncStatus: "complete",
      }),
    ).toBe(false)
    expect(
      shouldLoadSessionReviewDiff({
        sessionID: "ses_1",
        wantsReview: true,
        sessionDiff: {} as never,
        syncStatus: "loading",
      }),
    ).toBe(false)
  })
})
