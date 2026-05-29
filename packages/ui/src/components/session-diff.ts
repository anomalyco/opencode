import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { parsePatch, type StructuredPatch, type StructuredPatchHunk } from "diff"
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

type SnapshotDiff = SnapshotFileDiff & { file: string }
type ReviewDiff = SnapshotDiff | VcsFileDiff | LegacyDiff
export type DiffSource = Pick<LegacyDiff, "file" | "patch" | "before" | "after">

export type ViewDiff = {
  file: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const diffCacheLimit = 16
const generatedContextThreshold = 10
const patchFileDiffCache = new Map<string, FileDiffMetadata>()

export function resolveFileDiff(diff: DiffSource) {
  if (typeof diff.patch === "string") return fileDiffFromPatch(diff.file, diff.patch)
  return fileDiffFromContent(
    diff.file,
    typeof diff.before === "string" ? diff.before : "",
    typeof diff.after === "string" ? diff.after : "",
  )
}

export function normalize(diff: ReviewDiff): ViewDiff {
  return {
    file: diff.file,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: resolveFileDiff(diff),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")
  return diff.fileDiff.additionLines.join("")
}

function fileDiffFromPatch(file: string, patch: string) {
  const key = `${file}\0${patch}`
  const hit = patchFileDiffCache.get(key)
  if (hit) {
    patchFileDiffCache.delete(key)
    patchFileDiffCache.set(key, hit)
    return hit
  }

  const source = patchSource(file, patch)
  const value = source.complete
    ? fileDiffFromContent(file, source.complete.before, source.complete.after)
    : (source.input ? parsePatchFiles(source.input)[0]?.files[0] : undefined) ?? emptyFileDiff(file)
  patchFileDiffCache.set(key, value)
  while (patchFileDiffCache.size > diffCacheLimit) patchFileDiffCache.delete(patchFileDiffCache.keys().next().value!)
  return value
}

function patchSource(file: string, patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed) return {}
    return {
      complete: completeFileContentsFromPatch(parsed),
      input: patchInput(file, patch, parsed),
    }
  } catch {
    return {}
  }
}

function completeFileContentsFromPatch(patch: StructuredPatch) {
  if (!hasFileHeader(patch)) return
  if (!hasCompleteFileHunks(patch.hunks)) return
  return contentsFromHunks(patch.hunks)
}

function hasFileHeader(patch: StructuredPatch) {
  return "index" in patch || "oldFileName" in patch || "newFileName" in patch
}

function hasCompleteFileHunks(hunks: StructuredPatchHunk[]) {
  const first = hunks[0]
  if (!first) return false
  if (!startsAtFileBoundary(first.oldStart, first.oldLines)) return false
  if (!startsAtFileBoundary(first.newStart, first.newLines)) return false
  if (!hasGeneratedContext(hunks)) return false

  let oldStart = first.oldStart + first.oldLines
  let newStart = first.newStart + first.newLines
  for (const hunk of hunks.slice(1)) {
    if (hunk.oldStart !== oldStart) return false
    if (hunk.newStart !== newStart) return false
    oldStart += hunk.oldLines
    newStart += hunk.newLines
  }
  return true
}

function startsAtFileBoundary(start: number, lines: number) {
  if (start === 1) return true
  return start === 0 && lines === 0
}

function hasGeneratedContext(hunks: StructuredPatchHunk[]) {
  return hunks.some((hunk) => hunk.lines.some(longContextRun))
}

function longContextRun(line: string, index: number, lines: string[]) {
  if (!contextLine(line)) return false
  if (index > 0 && contextLine(lines[index - 1])) return false
  const end = lines.slice(index).findIndex((line) => !contextLine(line))
  return (end === -1 ? lines.length - index : end) > generatedContextThreshold
}

function contextLine(line: string) {
  return line.startsWith(" ")
}

function contentsFromHunks(hunks: StructuredPatchHunk[]) {
  const beforeLines: Array<{ text: string; newline: boolean }> = []
  const afterLines: Array<{ text: string; newline: boolean }> = []
  let previous: "-" | "+" | " " | undefined

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        const before = beforeLines.at(-1)
        const after = afterLines.at(-1)
        if ((previous === "-" || previous === " ") && before) before.newline = false
        if ((previous === "+" || previous === " ") && after) after.newline = false
        continue
      }

      if (line.startsWith("-")) {
        beforeLines.push({ text: line.slice(1), newline: true })
        previous = "-"
        continue
      }

      if (line.startsWith("+")) {
        afterLines.push({ text: line.slice(1), newline: true })
        previous = "+"
        continue
      }

      beforeLines.push({ text: line.slice(1), newline: true })
      afterLines.push({ text: line.slice(1), newline: true })
      previous = " "
    }
  }

  return {
    before: beforeLines.map((line) => line.text + (line.newline ? "\n" : "")).join(""),
    after: afterLines.map((line) => line.text + (line.newline ? "\n" : "")).join(""),
  }
}

function patchInput(file: string, patch: string, parsed: StructuredPatch) {
  if (parsed.index || parsed.oldFileName || parsed.newFileName) return patch
  if (!parsed.hunks.length) return
  return `Index: ${file}\n===================================================================\n--- ${file}\t\n+++ ${file}\t\n${patch}`
}

function fileDiffFromContent(file: string, before: string, after: string) {
  if (!before && !after) return emptyFileDiff(file)
  return parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
}

function emptyFileDiff(file: string) {
  return parseDiffFromFile({ name: file, contents: "" }, { name: file, contents: "" })
}
