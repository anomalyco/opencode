import { parsePatchFiles } from "@pierre/diffs"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"

type LegacyDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

type ReviewDiff = SnapshotFileDiff | VcsFileDiff | LegacyDiff

export type ViewDiff = ReviewDiff & {
  before: string
  after: string
}

const cache = new Map<string, { before: string; after: string }>()

function split(patch: string) {
  const hit = cache.get(patch)
  if (hit) return hit

  const file = parsePatchFiles(patch).flatMap((item) => item.files)[0]
  const value = {
    before: file?.deletionLines.join("") ?? "",
    after: file?.additionLines.join("") ?? "",
  }
  cache.set(patch, value)
  return value
}

export function inflate(diff: ReviewDiff): ViewDiff {
  if (!diff.patch) {
    return {
      ...diff,
      before: "before" in diff && typeof diff.before === "string" ? diff.before : "",
      after: "after" in diff && typeof diff.after === "string" ? diff.after : "",
    }
  }
  return { ...diff, ...split(diff.patch) }
}
