import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { diffLines } from "diff"
import { completePatchContents, normalize, type ViewDiff } from "./session-diff"

type Kind = "add" | "update" | "delete"

export type ApplyPatchFile = {
  path: string
  type: Kind
  additions: number
  deletions: number
  view: ViewDiff
  contents?: { before: string; after: string }
}

export type ApplyPatchFileGroup = Omit<ApplyPatchFile, "view" | "contents"> & { views: ViewDiff[] }

function fileDiff(value: unknown): value is FileDiffInfo {
  if (!value || typeof value !== "object") return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("patch" in value) || typeof value.patch !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  if (!("status" in value)) return false
  return value.status === "added" || value.status === "deleted" || value.status === "modified"
}

export function patchFile(value: unknown): ApplyPatchFile | undefined {
  if (!fileDiff(value)) return
  return {
    path: value.file,
    type: value.status === "added" ? "add" : value.status === "deleted" ? "delete" : "update",
    additions: value.additions,
    deletions: value.deletions,
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
      return {
        path,
        type,
        additions: files.reduce((total, file) => total + file.additions, 0),
        deletions: files.reduce((total, file) => total + file.deletions, 0),
        views: files.map((file) => file.view),
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
