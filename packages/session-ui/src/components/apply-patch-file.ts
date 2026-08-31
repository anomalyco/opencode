import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { diffLines, formatPatch, parsePatch } from "diff"
import { completePatchContents, normalize, type ViewDiff } from "./session-diff"

type Kind = "add" | "update" | "delete"

export type ApplyPatchFile = {
  path: string
  type: Kind
  additions: number
  deletions: number
  patch: string
  view: ViewDiff
  contents?: { before: string; after: string }
}

export type ApplyPatchFileGroup = Omit<ApplyPatchFile, "patch" | "view" | "contents"> & { views: ViewDiff[] }

export function changedFileDiff(value: unknown): value is FileDiffInfo {
  if (!value || typeof value !== "object") return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("patch" in value) || typeof value.patch !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  if (!("status" in value)) return false
  if (value.status !== "added" && value.status !== "deleted" && value.status !== "modified") return false
  return value.additions > 0 || value.deletions > 0
}

export function patchFile(value: unknown): ApplyPatchFile | undefined {
  if (!changedFileDiff(value)) return
  return {
    path: value.file,
    type: value.status === "added" ? "add" : value.status === "deleted" ? "delete" : "update",
    additions: value.additions,
    deletions: value.deletions,
    patch: value.patch,
    view: normalize(value),
    contents: completePatchContents(value.patch),
  }
}

export function patchFiles(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(patchFile).filter((file): file is ApplyPatchFile => !!file)
}

export function patchFileGroups(value: unknown): ApplyPatchFileGroup[] {
  const groups = patchFiles(value).reduce((result, file) => {
    const files = result.get(file.path)
    if (files) files.push(file)
    if (!files) result.set(file.path, [file])
    return result
  }, new Map<string, ApplyPatchFile[]>())
  return [...groups].map(([path, files]) => {
    const first = files[0]!
    const last = files.at(-1)!
    const type = last.type === "delete" ? "delete" : first.type === "add" ? "add" : "update"
    const chained = files.every(
      (file, index) => !!file.contents && (index === 0 || files[index - 1]?.contents?.after === file.contents.before),
    )
    if (!chained) {
      const additions = files.reduce((total, file) => total + file.additions, 0)
      const deletions = files.reduce((total, file) => total + file.deletions, 0)
      return {
        path,
        type,
        additions,
        deletions,
        views: mergePartialViews(path, type, additions, deletions, files),
      }
    }

    const before = first.contents!.before
    const after = last.contents!.after
    const counts = diffLines(before, after).reduce(
      (result, item) => ({
        additions: result.additions + (item.added ? (item.count ?? 0) : 0),
        deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
      }),
      { additions: 0, deletions: 0 },
    )
    return {
      path,
      type,
      ...counts,
      views: [
        normalize({
          file: path,
          before,
          after,
          status: type === "add" ? "added" : type === "delete" ? "deleted" : "modified",
          ...counts,
        }),
      ],
    }
  })
}

function mergePartialViews(path: string, type: Kind, additions: number, deletions: number, files: ApplyPatchFile[]) {
  try {
    const patches = files.map((file) => parsePatch(file.patch)[0])
    if (patches.some((patch) => !patch?.hunks.length)) return files.map((file) => file.view)
    const hunks = patches
      .flatMap((patch) => patch?.hunks ?? [])
      .toSorted((a, b) => Math.min(a.oldStart, a.newStart) - Math.min(b.oldStart, b.newStart))
    return [
      normalize({
        file: path,
        patch: formatPatch({ oldFileName: path, newFileName: path, oldHeader: "", newHeader: "", hunks }),
        status: type === "add" ? "added" : type === "delete" ? "deleted" : "modified",
        additions,
        deletions,
      }),
    ]
  } catch {
    return files.map((file) => file.view)
  }
}
