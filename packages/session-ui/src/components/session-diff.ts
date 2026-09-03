import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import { parsePatch } from "diff"
import { checksum } from "@opencode-ai/util/encode"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import type { PresentationFileDiff } from "../file-presentation"

type LegacyDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

type ReviewDiff = (PresentationFileDiff & { file: string }) | FileDiffInfo | LegacyDiff
export type DiffSource = Pick<LegacyDiff, "file" | "patch" | "before" | "after">

export type ViewDiff = {
  file: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const diffCacheLimit = 16
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

  const contents = completePatchContents(patch)
  const input = contents ? undefined : patchInput(file, patch)
  const value = contents
    ? fileDiffFromContent(file, contents.before, contents.after)
    : ((input ? parsePatchFiles(input)[0]?.files[0] : undefined) ?? emptyFileDiff(file))
  // Complete patches already carry a content key from fileDiffFromContent; partial patches are keyed by the patch text.
  value.cacheKey ??= highlightKey(key)
  patchFileDiffCache.set(key, value)
  while (patchFileDiffCache.size > diffCacheLimit) patchFileDiffCache.delete(patchFileDiffCache.keys().next().value!)
  return value
}

export function completePatchContents(patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed || (!parsed.index && !parsed.oldFileName && !parsed.newFileName)) return
    // Snapshot and VCS producers request full context. Tool patches use jsdiff's shorter default context.
    if (!patch.startsWith("diff --git ") && !/^--- [^\n]*\t\r?\n\+\+\+ [^\n]*\t(?:\r?\n|$)/m.test(patch)) return
    // Full patches collapse into one leading hunk. Separated hunks omit ranges and must stay partial.
    if (parsed.hunks.length !== 1) return

    const hunk = parsed.hunks[0]
    if (!hunk || hunk.oldStart > 1 || hunk.newStart > 1) return

    const before: Array<{ text: string; newline: boolean }> = []
    const after: Array<{ text: string; newline: boolean }> = []
    let previous: "-" | "+" | " " | undefined

    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        if (previous === "-" || previous === " ") {
          const value = before.at(-1)
          if (value) value.newline = false
        }
        if (previous === "+" || previous === " ") {
          const value = after.at(-1)
          if (value) value.newline = false
        }
        continue
      }
      if (line.startsWith("-")) {
        before.push({ text: line.slice(1), newline: true })
        previous = "-"
        continue
      }
      if (line.startsWith("+")) {
        after.push({ text: line.slice(1), newline: true })
        previous = "+"
        continue
      }
      if (!line.startsWith(" ")) return
      before.push({ text: line.slice(1), newline: true })
      after.push({ text: line.slice(1), newline: true })
      previous = " "
    }

    const text = (lines: Array<{ text: string; newline: boolean }>) =>
      lines.map((line) => line.text + (line.newline ? "\n" : "")).join("")
    return { before: text(before), after: text(after) }
  } catch {
    return
  }
}

function patchInput(file: string, patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed) return
    if (parsed.index || parsed.oldFileName || parsed.newFileName) return patch
    if (!parsed.hunks.length) return
    return `Index: ${file}\n===================================================================\n--- ${file}\t\n+++ ${file}\t\n${patch}`
  } catch {
    return
  }
}

function fileDiffFromContent(file: string, before: string, after: string) {
  if (!before && !after) return emptyFileDiff(file)
  const value = parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
  value.cacheKey = highlightKey(`${file}\0${before}\0${after}`)
  return value
}

// Pierre reuses and dedups worker highlighting only for diffs that carry a cacheKey, and it treats diffs with equal
// keys as the same target. Derive the key from every input that shapes the highlighted output: the file name selects
// the language and the content selects the lines.
function highlightKey(value: string) {
  return `${value.length}:${checksum(value) ?? 0}`
}

function emptyFileDiff(file: string) {
  return parseDiffFromFile({ name: file, contents: "" }, { name: file, contents: "" })
}
