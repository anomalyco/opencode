import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

export type ReviewDiff = ((SnapshotFileDiff & { file: string }) | VcsFileDiff) & {
  preloaded?: PreloadMultiFileDiffResult<any>
}

function diff(value: unknown): value is ReviewDiff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  if ("patch" in value && value.patch !== undefined && typeof value.patch !== "string") return false
  if ("before" in value && value.before !== undefined && typeof value.before !== "string") return false
  if ("after" in value && value.after !== undefined && typeof value.after !== "string") return false
  if (!("status" in value) || value.status === undefined) return true
  return value.status === "added" || value.status === "deleted" || value.status === "modified"
}

export function listReviewDiffs(value: unknown): ReviewDiff[] {
  if (Array.isArray(value) && value.every(diff)) return value
  if (Array.isArray(value)) return value.filter(diff)
  if (diff(value)) return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).filter(diff)
}
