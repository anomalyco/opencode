import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"

function deletionOnly(part: ToolPart) {
  if (!("metadata" in part.state)) return false
  const metadata = part.state.metadata
  if (!metadata) return false

  const files = metadata.files
  if (Array.isArray(files) && files.length > 0) {
    return files.every(
      (file) =>
        !!file &&
        typeof file === "object" &&
        (("type" in file && file.type === "delete") || ("status" in file && file.status === "deleted")),
    )
  }

  const filediff = metadata.filediff
  if (!filediff || typeof filediff !== "object") return false
  if (!("additions" in filediff) || !("deletions" in filediff)) return false
  return filediff.additions === 0 && typeof filediff.deletions === "number" && filediff.deletions > 0
}

export function partDefaultOpen(part: PartType, shell = false, edit = false): boolean | undefined {
  if (part.type !== "tool") return undefined
  if (part.tool === "bash" || part.tool === "shell" || part.tool === "execute") return shell
  if (part.tool === "edit" || part.tool === "write" || part.tool === "patch" || part.tool === "apply_patch") {
    if (!edit) return false
    return !deletionOnly(part)
  }
  return undefined
}
