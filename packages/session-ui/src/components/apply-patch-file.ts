import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { normalize, type ViewDiff } from "./session-diff"

type Kind = "add" | "update" | "delete"

export type ApplyPatchFile = {
  path: string
  type: Kind
  additions: number
  deletions: number
  view: ViewDiff
}

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
  }
}

export function patchFiles(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(patchFile).filter((file): file is ApplyPatchFile => !!file)
}
