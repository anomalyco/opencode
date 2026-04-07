import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { sampledChecksum } from "@opencode-ai/util/encode"
import { formatPatch, structuredPatch } from "diff"
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

export type ViewDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const cache = new Map<string, FileDiffMetadata>()

function empty(file: string, key: string) {
  return {
    name: file,
    type: "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    cacheKey: key,
  } satisfies FileDiffMetadata
}

function patch(diff: ReviewDiff) {
  if (typeof diff.patch === "string") return diff.patch
  return formatPatch(
    structuredPatch(
      diff.file,
      diff.file,
      "before" in diff && typeof diff.before === "string" ? diff.before : "",
      "after" in diff && typeof diff.after === "string" ? diff.after : "",
      "",
      "",
      { context: Number.MAX_SAFE_INTEGER },
    ),
  )
}

function file(file: string, patch: string) {
  const hit = cache.get(patch)
  if (hit) return hit

  const key = sampledChecksum(patch) ?? file
  const value = parsePatchFiles(patch, key).flatMap((item) => item.files)[0] ?? empty(file, key)
  cache.set(patch, value)
  return value
}

export function normalize(diff: ReviewDiff): ViewDiff {
  const next = patch(diff)
  return {
    file: diff.file,
    patch: next,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: file(diff.file, next),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")
  return diff.fileDiff.additionLines.join("")
}
