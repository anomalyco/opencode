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
type NormalizeOptions = {
  preservePatchLineNumbers?: boolean
}

export type ViewDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const cache = new Map<string, FileDiffMetadata>()

function patch(diff: ReviewDiff, options?: NormalizeOptions) {
  if (typeof diff.patch === "string") {
    try {
      const [patch] = parsePatch(diff.patch)
      const beforeLines: Array<{ text: string; newline: boolean } | undefined> = []
      const afterLines: Array<{ text: string; newline: boolean } | undefined> = []
      let previous: "-" | "+" | " " | undefined
      let oldIndex = 0
      let newIndex = 0

      const push = (
        lines: Array<{ text: string; newline: boolean } | undefined>,
        index: number,
        text: string,
      ) => {
        while (lines.length < index) lines.push({ text: "", newline: true })
        lines[index] = { text, newline: true }
      }

      for (const hunk of patch.hunks) {
        if (options?.preservePatchLineNumbers) {
          oldIndex = hunk.oldStart - 1
          newIndex = hunk.newStart - 1
        }
        for (const line of hunk.lines) {
          if (line.startsWith("\\")) {
            if (previous === "-" || previous === " ") {
              const before = beforeLines.findLast(Boolean)
              if (before) before.newline = false
            }
            if (previous === "+" || previous === " ") {
              const after = afterLines.findLast(Boolean)
              if (after) after.newline = false
            }
            continue
          }

          if (line.startsWith("-")) {
            if (options?.preservePatchLineNumbers) {
              push(beforeLines, oldIndex, line.slice(1))
              oldIndex++
            } else {
              beforeLines.push({ text: line.slice(1), newline: true })
            }
            previous = "-"
          } else if (line.startsWith("+")) {
            if (options?.preservePatchLineNumbers) {
              push(afterLines, newIndex, line.slice(1))
              newIndex++
            } else {
              afterLines.push({ text: line.slice(1), newline: true })
            }
            previous = "+"
          } else {
            // context line (starts with ' ')
            if (options?.preservePatchLineNumbers) {
              push(beforeLines, oldIndex, line.slice(1))
              push(afterLines, newIndex, line.slice(1))
              oldIndex++
              newIndex++
            } else {
              beforeLines.push({ text: line.slice(1), newline: true })
              afterLines.push({ text: line.slice(1), newline: true })
            }
            previous = " "
          }
        }
      }

      return {
        before: beforeLines.map((line) => (line?.text ?? "") + (line?.newline === false ? "" : "\n")).join(""),
        after: afterLines.map((line) => (line?.text ?? "") + (line?.newline === false ? "" : "\n")).join(""),
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

export function normalize(diff: ReviewDiff, options?: NormalizeOptions): ViewDiff {
  const next = patch(diff, options)
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
