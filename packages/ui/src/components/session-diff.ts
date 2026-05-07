import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs"
import { formatPatch, parsePatch, structuredPatch } from "diff"
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

function patch(diff: ReviewDiff) {
  if (typeof diff.patch === "string") {
    try {
      const [patch] = parsePatch(diff.patch)
      const beforeLines: Array<{ text: string; newline: boolean }> = []
      const afterLines: Array<{ text: string; newline: boolean }> = []
      let previous: "-" | "+" | " " | undefined

      for (const hunk of patch.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith("\\")) {
            if (previous === "-" || previous === " ") {
              const before = beforeLines.at(-1)
              if (before) before.newline = false
            }
            if (previous === "+" || previous === " ") {
              const after = afterLines.at(-1)
              if (after) after.newline = false
            }
            continue
          }

          if (line.startsWith("-")) {
            beforeLines.push({ text: line.slice(1), newline: true })
            previous = "-"
          } else if (line.startsWith("+")) {
            afterLines.push({ text: line.slice(1), newline: true })
            previous = "+"
          } else {
            // context line (starts with ' ')
            beforeLines.push({ text: line.slice(1), newline: true })
            afterLines.push({ text: line.slice(1), newline: true })
            previous = " "
          }
        }
      }

      return {
        before: beforeLines.map((line) => line.text + (line.newline ? "\n" : "")).join(""),
        after: afterLines.map((line) => line.text + (line.newline ? "\n" : "")).join(""),
        patch: diff.patch,
      }
    } catch {
      return { before: "", after: "", patch: diff.patch }
    }
  }
  return {
    before: "before" in diff && typeof diff.before === "string" ? diff.before : "",
    after: "after" in diff && typeof diff.after === "string" ? diff.after : "",
    patch: formatPatch(
      structuredPatch(
        diff.file,
        diff.file,
        "before" in diff && typeof diff.before === "string" ? diff.before : "",
        "after" in diff && typeof diff.after === "string" ? diff.after : "",
        "",
        "",
        { context: Number.MAX_SAFE_INTEGER },
      ),
    ),
  }
}

function file(file: string, patch: string, before: string, after: string) {
  const hit = cache.get(patch)
  if (hit) return hit

  const value = parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
  cache.set(patch, value)
  return value
}

export function normalize(diff: ReviewDiff): ViewDiff {
  const next = patch(diff)
  return {
    file: diff.file,
    patch: next.patch,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: file(diff.file, next.patch, next.before, next.after),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")
  return diff.fileDiff.additionLines.join("")
}
