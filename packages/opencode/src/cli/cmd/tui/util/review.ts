import type { Snapshot } from "@/snapshot"

export type ReviewStatus = "pending" | "approved" | "rejected"

export interface FileReview {
  file: string
  status: ReviewStatus
  feedback?: string
}

export interface ReviewItem {
  diff: Snapshot.FileDiff
  review: FileReview
}

/**
 * Get the count of pending reviews from a list of review items.
 */
export function getPendingCount(reviews: ReviewItem[]): number {
  return reviews.filter((r) => r.review.status === "pending").length
}

/**
 * Check if all reviews have been processed (non-pending).
 */
export function allReviewed(reviews: ReviewItem[]): boolean {
  return reviews.length > 0 && reviews.every((r) => r.review.status !== "pending")
}

/**
 * Clamp an index to a valid range for the given diffs array.
 */
export function clampIndex(index: number, diffsLength: number): number {
  const maxIdx = Math.max(0, diffsLength - 1)
  return Math.min(Math.max(0, index), maxIdx)
}

/**
 * Generate feedback message to send to the agent based on review statuses.
 * Only includes rejected changes with their reasons - approved changes are silently dismissed.
 * Returns null if there are no rejections.
 */
export function generateFeedbackMessage(reviews: ReviewItem[]): string | null {
  const rejected = reviews.filter((r) => r.review.status === "rejected")

  if (rejected.length === 0) return null

  const lines: string[] = ["## Review Feedback\n"]
  lines.push("Please revert or reconsider the following changes:\n")

  for (const r of rejected) {
    lines.push(`- \`${r.diff.file}\``)
    if (r.review.feedback) {
      lines.push(`  - Reason: ${r.review.feedback}`)
    }
  }

  return lines.join("\n")
}
