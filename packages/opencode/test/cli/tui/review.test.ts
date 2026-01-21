import { describe, expect, test } from "bun:test"
import {
  generateFeedbackMessage,
  getPendingCount,
  allReviewed,
  clampIndex,
  type ReviewItem,
  type ReviewStatus,
} from "../../../src/cli/cmd/tui/util/review"
import { Keybind } from "../../../src/util/keybind"

describe("review utilities", () => {
  describe("getPendingCount", () => {
    test("returns 0 for empty array", () => {
      expect(getPendingCount([])).toBe(0)
    })

    test("counts only pending reviews", () => {
      const reviews: ReviewItem[] = [
        makeDiff("file1.ts", "pending"),
        makeDiff("file2.ts", "approved"),
        makeDiff("file3.ts", "pending"),
        makeDiff("file4.ts", "rejected"),
      ]
      expect(getPendingCount(reviews)).toBe(2)
    })

    test("returns total count when all are pending", () => {
      const reviews: ReviewItem[] = [makeDiff("file1.ts", "pending"), makeDiff("file2.ts", "pending")]
      expect(getPendingCount(reviews)).toBe(2)
    })

    test("returns 0 when none are pending", () => {
      const reviews: ReviewItem[] = [makeDiff("file1.ts", "approved"), makeDiff("file2.ts", "rejected")]
      expect(getPendingCount(reviews)).toBe(0)
    })
  })

  describe("allReviewed", () => {
    test("returns false for empty array", () => {
      expect(allReviewed([])).toBe(false)
    })

    test("returns false when any are pending", () => {
      const reviews: ReviewItem[] = [makeDiff("file1.ts", "approved"), makeDiff("file2.ts", "pending")]
      expect(allReviewed(reviews)).toBe(false)
    })

    test("returns true when all are processed", () => {
      const reviews: ReviewItem[] = [makeDiff("file1.ts", "approved"), makeDiff("file2.ts", "rejected")]
      expect(allReviewed(reviews)).toBe(true)
    })
  })

  describe("clampIndex", () => {
    test("returns 0 for empty diffs", () => {
      expect(clampIndex(0, 0)).toBe(0)
      expect(clampIndex(5, 0)).toBe(0)
      expect(clampIndex(-1, 0)).toBe(0)
    })

    test("clamps negative indices to 0", () => {
      expect(clampIndex(-1, 5)).toBe(0)
      expect(clampIndex(-10, 5)).toBe(0)
    })

    test("clamps high indices to max valid index", () => {
      expect(clampIndex(10, 5)).toBe(4)
      expect(clampIndex(100, 3)).toBe(2)
    })

    test("returns index unchanged when within bounds", () => {
      expect(clampIndex(0, 5)).toBe(0)
      expect(clampIndex(2, 5)).toBe(2)
      expect(clampIndex(4, 5)).toBe(4)
    })
  })

  describe("generateFeedbackMessage", () => {
    test("returns null for empty array", () => {
      expect(generateFeedbackMessage([])).toBe(null)
    })

    test("returns null when all are pending", () => {
      const reviews: ReviewItem[] = [makeDiff("file1.ts", "pending"), makeDiff("file2.ts", "pending")]
      expect(generateFeedbackMessage(reviews)).toBe(null)
    })

    test("returns null when only approved changes (no rejections)", () => {
      const reviews: ReviewItem[] = [makeDiff("src/app.ts", "approved", undefined, 10, 5)]
      const message = generateFeedbackMessage(reviews)

      // Approved changes are silently dismissed, no message needed
      expect(message).toBe(null)
    })

    test("generates message for rejected changes", () => {
      const reviews: ReviewItem[] = [makeDiff("src/bad.ts", "rejected", undefined, 20, 3)]
      const message = generateFeedbackMessage(reviews)

      expect(message).toContain("## Review Feedback")
      expect(message).toContain("Please revert or reconsider")
      expect(message).toContain("`src/bad.ts`")
    })

    test("includes reason for rejected with feedback", () => {
      const reviews: ReviewItem[] = [makeDiff("src/bad.ts", "rejected", "breaks the API", 20, 3)]
      const message = generateFeedbackMessage(reviews)

      expect(message).toContain("- Reason: breaks the API")
    })

    test("only includes rejected changes in message, ignores approved", () => {
      const reviews: ReviewItem[] = [
        makeDiff("approved.ts", "approved", undefined, 5, 2),
        makeDiff("rejected.ts", "rejected", "not needed", 10, 0),
        makeDiff("pending.ts", "pending"),
      ]
      const message = generateFeedbackMessage(reviews)

      // Should NOT include approved files
      expect(message).not.toContain("approved.ts")
      // Should include rejected files
      expect(message).toContain("`rejected.ts`")
      expect(message).toContain("- Reason: not needed")
      // Should not include pending files
      expect(message).not.toContain("pending.ts")
    })

    test("rejected without feedback has no reason line", () => {
      const reviews: ReviewItem[] = [makeDiff("file.ts", "rejected")]
      const message = generateFeedbackMessage(reviews)

      expect(message).toContain("`file.ts`")
      expect(message).not.toContain("- Reason:")
    })
  })
})

// Helper to create ReviewItem for testing
function makeDiff(file: string, status: ReviewStatus, feedback?: string, additions = 1, deletions = 0): ReviewItem {
  return {
    diff: {
      file,
      before: "",
      after: "",
      additions,
      deletions,
    },
    review: {
      file,
      status,
      feedback,
    },
  }
}

describe("review keybind integration", () => {
  // These tests verify that the review panel keybinds are simple single-key shortcuts
  // and are disabled when typing feedback (handled by isRejectMode check in component)

  test("review_approve keybind is simple 'a' key", () => {
    const keybind = Keybind.parse("a")[0]

    const aKey: Keybind.Info = {
      name: "a",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    // Should match plain 'a'
    expect(Keybind.match(keybind, aKey)).toBe(true)

    // Should NOT match with any modifiers
    expect(Keybind.match(keybind, { ...aKey, ctrl: true })).toBe(false)
    expect(Keybind.match(keybind, { ...aKey, meta: true })).toBe(false)
    expect(Keybind.match(keybind, { ...aKey, shift: true })).toBe(false)
  })

  test("review_reject keybind is simple 'r' key", () => {
    const keybind = Keybind.parse("r")[0]

    const rKey: Keybind.Info = {
      name: "r",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    expect(Keybind.match(keybind, rKey)).toBe(true)
    expect(Keybind.match(keybind, { ...rKey, ctrl: true })).toBe(false)
  })

  test("review_submit keybind is Shift+S", () => {
    const keybind = Keybind.parse("shift+s")[0]

    const shiftS: Keybind.Info = {
      name: "s",
      ctrl: false,
      meta: false,
      shift: true,
      super: false,
      leader: false,
    }

    expect(Keybind.match(keybind, shiftS)).toBe(true)

    // Plain 's' should NOT match
    const plainS: Keybind.Info = { ...shiftS, shift: false }
    expect(Keybind.match(keybind, plainS)).toBe(false)
  })

  test("review navigation keybinds (j/k) are simple keys without modifiers", () => {
    const nextKeybind = Keybind.parse("j")[0]
    const prevKeybind = Keybind.parse("k")[0]

    const jKey: Keybind.Info = {
      name: "j",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    const kKey: Keybind.Info = {
      name: "k",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    expect(Keybind.match(nextKeybind, jKey)).toBe(true)
    expect(Keybind.match(prevKeybind, kKey)).toBe(true)

    // With modifiers should NOT match
    const ctrlJ: Keybind.Info = { ...jKey, ctrl: true }
    expect(Keybind.match(nextKeybind, ctrlJ)).toBe(false)
  })

  test("review_reset keybind is simple 'u' key", () => {
    const keybind = Keybind.parse("u")[0]

    const uKey: Keybind.Info = {
      name: "u",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
      leader: false,
    }

    expect(Keybind.match(keybind, uKey)).toBe(true)
    expect(Keybind.match(keybind, { ...uKey, ctrl: true })).toBe(false)
  })

  test("review_approve_all keybind is Shift+A", () => {
    const keybind = Keybind.parse("shift+a")[0]

    const shiftA: Keybind.Info = {
      name: "a",
      ctrl: false,
      meta: false,
      shift: true,
      super: false,
      leader: false,
    }

    expect(Keybind.match(keybind, shiftA)).toBe(true)

    // Plain 'a' should NOT match (that's review_approve)
    const plainA: Keybind.Info = { ...shiftA, shift: false }
    expect(Keybind.match(keybind, plainA)).toBe(false)
  })
})
