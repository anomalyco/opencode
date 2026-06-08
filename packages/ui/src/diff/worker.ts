import { parseDiffFromFile, parsePatchFiles } from "@pierre/diffs"
import { parsePatch } from "diff"
import type { DiffWorkerRequest, DiffWorkerResponse } from "./protocol"

type DiffSource = { file: string; patch?: string; before?: string; after?: string }
type PreparedDiff = { fileDiff: any; deletions: string; additions: string }

export function prepareDiff(diff: DiffSource): PreparedDiff {
  const fileDiff = resolveFileDiff(diff)
  return {
    fileDiff,
    deletions: fileDiff.deletionLines.join(""),
    additions: fileDiff.additionLines.join(""),
  }
}

function resolveFileDiff(diff: DiffSource): any {
  if (diff.patch !== undefined) return fileDiffFromPatch(diff.file, diff.patch)
  return fileDiffFromContent(diff.file, diff.before ?? "", diff.after ?? "")
}

function fileDiffFromPatch(file: string, patch: string) {
  const contents = completePatchContents(patch)
  const input = contents ? undefined : patchInput(file, patch)
  return contents
    ? fileDiffFromContent(file, contents.before, contents.after)
    : ((input ? parsePatchFiles(input)[0]?.files[0] : undefined) ?? emptyFileDiff(file))
}

function completePatchContents(patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed || (!parsed.index && !parsed.oldFileName && !parsed.newFileName)) return
    if (!patch.startsWith("diff --git ") && !/^--- [^\n]*\t\r?\n\+\+\+ [^\n]*\t(?:\r?\n|$)/m.test(patch)) return
    if (parsed.hunks.length !== 1) return
    const hunk = parsed.hunks[0]
    if (!hunk || hunk.oldStart > 1 || hunk.newStart > 1) return
    const before: Array<{ text: string; newline: boolean }> = []
    const after: Array<{ text: string; newline: boolean }> = []
    let previous: "-" | "+" | " " | undefined
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        if (previous === "-" || previous === " ") { const value = before.at(-1); if (value) value.newline = false }
        if (previous === "+" || previous === " ") { const value = after.at(-1); if (value) value.newline = false }
        continue
      }
      if (line.startsWith("-")) { before.push({ text: line.slice(1), newline: true }); previous = "-"; continue }
      if (line.startsWith("+")) { after.push({ text: line.slice(1), newline: true }); previous = "+"; continue }
      if (!line.startsWith(" ")) return
      before.push({ text: line.slice(1), newline: true }); after.push({ text: line.slice(1), newline: true }); previous = " "
    }
    const text = (lines: Array<{ text: string; newline: boolean }>) =>
      lines.map((line) => line.text + (line.newline ? "\n" : "")).join("")
    return { before: text(before), after: text(after) }
  } catch { return }
}

function patchInput(file: string, patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed) return
    if (parsed.index || parsed.oldFileName || parsed.newFileName) return patch
    if (!parsed.hunks.length) return
    return `Index: ${file}\n===================================================================\n--- ${file}\t\n+++ ${file}\t\n${patch}`
  } catch { return }
}

function fileDiffFromContent(file: string, before: string, after: string): any {
  if (!before && !after) return emptyFileDiff(file)
  return parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
}

function emptyFileDiff(file: string): any {
  return parseDiffFromFile({ name: file, contents: "" }, { name: file, contents: "" })
}

// Only register the message handler inside the Web Worker, not when imported for tests
if (typeof self !== "undefined" && "Window" in self === false) {
  self.addEventListener("message", (event: MessageEvent<DiffWorkerRequest>) => {
    try {
      self.postMessage({ id: event.data.id, result: prepareDiff(event.data.source) } satisfies DiffWorkerResponse)
    } catch (error) {
      self.postMessage({
        id: event.data.id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies DiffWorkerResponse)
    }
  })
}
